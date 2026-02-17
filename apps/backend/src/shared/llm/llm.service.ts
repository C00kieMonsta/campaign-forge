import * as crypto from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  LLM_MODELS,
  LLM_PROVIDER_PRIORITY,
  LLMProvider,
  TaskCriticality
} from "@packages/types";
import { ZodSchema } from "zod";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { ChatRequest } from "@/shared/llm/schemas/request";
import { ChatResponse } from "@/shared/llm/schemas/response";
import {
  AIServiceInterface,
  LLMOptions
} from "@/shared/llm/services/ai-service.interface";
import { AnthropicService } from "@/shared/llm/services/anthropic.service";
import { GeminiService } from "@/shared/llm/services/gemini.service";
import { OpenAIService } from "@/shared/llm/services/openai.service";
import { Attachment } from "@/shared/llm/types/attachments";

/**
 * LLMRequest encapsulates parameters for LLM calls with provider fallback support.
 */
export interface LLMRequest<T = any> {
  systemPrompt: string;
  userPrompt: string;
  criticality?: TaskCriticality;
  schema?: ZodSchema<T>;
  attachments?: Attachment[];
  temperature?: number;
  maxOutputTokens?: number;
  timeout?: number;
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly geminiService: GeminiService,
    private readonly anthropicService: AnthropicService,
    private readonly blobStorage: BlobStorageService
  ) {}

  /**
   * Get the service instance for a given provider.
   */
  private getServiceByProvider(provider: LLMProvider): AIServiceInterface {
    const services: Record<LLMProvider, AIServiceInterface> = {
      gemini: this.geminiService,
      openai: this.openAIService,
      anthropic: this.anthropicService
    };
    return services[provider];
  }

  /**
   * Select the appropriate model based on provider and task criticality.
   */
  private selectModel(
    provider: LLMProvider,
    criticality: TaskCriticality
  ): string {
    return LLM_MODELS[provider][criticality];
  }

  /**
   * Primary method: Execute LLM request with provider fallback.
   * Tries providers in priority order until one succeeds.
   *
   * @param request The LLM request containing prompts and schema
   * @returns The response as a structured object or plain string
   * @throws Error if all providers fail
   */
  async ask<T = any>(request: LLMRequest<T>): Promise<T | string> {
    const criticality = request.criticality ?? "medium";
    const errors: Array<{ provider: LLMProvider; error: string }> = [];

    // Build options object from request parameters
    const options: LLMOptions = {
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      timeout: request.timeout
    };

    for (const provider of LLM_PROVIDER_PRIORITY) {
      try {
        const model = this.selectModel(provider, criticality);

        this.logger.debug(
          JSON.stringify({
            level: "debug",
            action: "llmRequest",
            provider,
            model,
            criticality,
            timestamp: new Date().toISOString()
          })
        );

        const service = this.getServiceByProvider(provider);
        const result = await service.ask(
          request.systemPrompt,
          request.userPrompt,
          request.schema,
          request.attachments,
          model,
          options
        );

        this.logger.debug(
          JSON.stringify({
            level: "debug",
            action: "llmRequestSuccess",
            provider,
            model,
            timestamp: new Date().toISOString()
          })
        );

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "llmProviderFailed",
            provider,
            error: errorMsg,
            timestamp: new Date().toISOString()
          })
        );

        errors.push({ provider, error: errorMsg });
      }
    }

    // All providers failed
    const errorDetails = errors
      .map((e) => `${e.provider}: ${e.error}`)
      .join("; ");

    this.logger.error(
      JSON.stringify({
        level: "error",
        action: "allLLMProvidersFailed",
        criticality,
        attempts: errors.map((e) => `${e.provider} (${e.error})`),
        timestamp: new Date().toISOString()
      })
    );

    throw new Error(
      `All LLM providers failed for ${criticality} criticality task. Attempts: ${errorDetails}`
    );
  }

  /**
   * Chat method for backward compatibility with legacy ChatRequest format.
   * Converts ChatRequest to LLMRequest and uses fallback chain.
   */
  async chat(
    request: ChatRequest,
    criticality: TaskCriticality = "medium"
  ): Promise<ChatResponse> {
    try {
      const systemMessage =
        request.messages.find((m) => m.role === "system")?.content || "";
      const userMessages = request.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");

      const response = await this.ask({
        systemPrompt: systemMessage,
        userPrompt: userMessages,
        criticality
      });

      return {
        content: response as string,
        usage: null
      };
    } catch (error) {
      throw new Error(
        `Failed to get chat completion: ${(error as Error).message}`
      );
    }
  }

  /**
   * Generate content with image buffers using provider fallback.
   * Supports both single buffer and multiple buffers.
   */
  async generateWithBuffers<T = any>(
    systemPrompt: string,
    userPrompt: string,
    imageBuffers?: Buffer | Buffer[],
    mediaTypes?: string | string[],
    schema?: ZodSchema<T>,
    criticality: TaskCriticality = "medium",
    options?: LLMOptions,
    jobId?: string
  ): Promise<T | string> {
    const bufferSizeKB = Array.isArray(imageBuffers)
      ? imageBuffers.reduce((sum, b) => sum + b.length, 0) / 1024
      : imageBuffers
        ? imageBuffers.length / 1024
        : 0;

    this.logger.log(
      `[generateWithBuffers] Starting: ${Math.round(bufferSizeKB)} KB buffer, ${mediaTypes}, criticality: ${criticality}`
    );
    console.log(
      `[LLM generateWithBuffers] Starting with ${Math.round(bufferSizeKB)} KB media file (${criticality})`
    );

    try {
      const normalizedImageBuffers: Buffer[] = Array.isArray(imageBuffers)
        ? imageBuffers
        : imageBuffers
          ? [imageBuffers]
          : [];

      const normalizedMediaTypes: string[] = Array.isArray(mediaTypes)
        ? mediaTypes
        : mediaTypes
          ? [mediaTypes]
          : [];

      const attachments: Attachment[] = [];

      for (let idx = 0; idx < normalizedImageBuffers.length; idx++) {
        const buffer = normalizedImageBuffers[idx];
        const mimeType =
          normalizedMediaTypes[idx] || "application/octet-stream";
        let s3Url: string | undefined;

        if (jobId) {
          // Generate unique key for media file
          const hash = crypto.randomBytes(4).toString("hex");
          const ext = this.getExtension(mimeType);
          const key = `extraction/${jobId}/media/${Date.now()}-${hash}${ext}`;

          // Upload to S3 using existing blob storage service
          await this.blobStorage.uploadForProcessing(key, buffer, mimeType);

          // Generate presigned URL for provider access (10 min expiry)
          s3Url = await this.blobStorage.generateDownloadUrl(
            key,
            "processing",
            {
              expiresIn: 600
            }
          );
        }

        attachments.push({
          data: buffer.toString("base64"),
          buffer: buffer,
          mimeType,
          s3Url
        });
      }

      return await this.ask({
        systemPrompt,
        userPrompt,
        schema,
        attachments,
        criticality,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxOutputTokens,
        timeout: options?.timeout
      });
    } catch (error: unknown) {
      throw new Error(
        `Failed to generate content with buffers: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get file extension from MIME type
   */
  private getExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "application/pdf": ".pdf"
    };
    return extensions[mimeType] || "";
  }
}
