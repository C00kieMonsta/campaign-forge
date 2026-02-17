import { Injectable, Logger } from "@nestjs/common";
import * as OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ZodSchema } from "zod";
import { ConfigService } from "@/config/config.service";
import {
  AIServiceInterface,
  LLMOptions
} from "@/shared/llm/services/ai-service.interface";
import { Attachment } from "@/shared/llm/types/attachments";

@Injectable()
export class OpenAIService implements AIServiceInterface {
  private readonly logger = new Logger(OpenAIService.name);
  private openaiClient: OpenAI.OpenAI | null = null;
  private readonly defaultModel = "gpt-5-mini";

  constructor(private readonly configService: ConfigService) {}

  private get timeoutMs(): number {
    const v = Number(this.configService.get("LLM_TIMEOUT_MS"));
    return Number.isFinite(v) && v > 0
      ? Math.min(120000, Math.max(5000, Math.floor(v)))
      : 45000;
  }

  private get defaultTemperature(): number {
    const v = Number(this.configService.get("LLM_TEMPERATURE"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.2;
  }

  private get defaultMaxTokens(): number {
    const v = Number(this.configService.get("LLM_MAX_OUTPUT_TOKENS_PRIMARY"));
    return Number.isFinite(v) && v > 0 ? Math.min(8192, Math.floor(v)) : 2048;
  }

  /**
   * Lazily initialize the OpenAI client.
   */
  private initializeClient() {
    if (!this.openaiClient) {
      const apiKey = this.configService.get("OPENAI_API_KEY");

      try {
        this.openaiClient = new OpenAI.default.OpenAI({
          apiKey: apiKey
        });
      } catch (error) {
        this.logger.error(
          "OpenAI initialization failed:",
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    }
  }

  /**
   * Send a prompt to OpenAI with separate system and human messages and optional structured output parsing.
   *
   * @param systemMessage The system message to set context for the assistant.
   * @param humanMessage The human message to provide the prompt.
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments.
   * @param model Optional model to use (defaults to gpt-5-mini).
   * @param options Optional LLM options (temperature, maxOutputTokens, timeout)
   * @returns The response as a structured object or plain string.
   */
  async ask<T>(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: ZodSchema<T>,
    attachments?: Attachment[],
    model?: string,
    options?: LLMOptions
  ): Promise<T | string> {
    try {
      this.initializeClient();
      const useModel = model ?? this.defaultModel;

      const temperature = options?.temperature ?? this.defaultTemperature;
      const maxTokens = options?.maxOutputTokens ?? this.defaultMaxTokens;
      const timeout = options?.timeout ?? this.timeoutMs;

      // Build message content
      const userContent: Array<any> = [{ type: "text", text: userPrompt }];

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.s3Url) {
            userContent.push({
              type: "image_url",
              image_url: { url: att.s3Url, detail: "high" }
            });
          } else if (att.data && att.mimeType) {
            userContent.push({
              type: "image_url",
              image_url: {
                url: `data:${att.mimeType};base64,${att.data}`,
                detail: "high"
              }
            });
          }
        }
      }

      if (!responseSchema) {
        // Handle unstructured responses
        const completion = await Promise.race([
          this.openaiClient!.chat.completions.create({
            model: useModel,
            temperature,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent as any }
            ]
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`OpenAI API request timed out after ${timeout} ms`)
                ),
              timeout
            )
          )
        ]);

        let content = completion.choices[0].message.content || "";

        // Clean markdown code block if present
        content = content
          .replace(/^```(json)?/, "")
          .replace(/```$/, "")
          .trim();

        return content;
      }

      // Handle structured responses using zodResponseFormat helper
      const schemaName = "structured_response";
      const completion = await Promise.race([
        this.openaiClient!.chat.completions.parse({
          model: useModel,
          temperature,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent as any }
          ],
          response_format: zodResponseFormat(responseSchema, schemaName)
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`OpenAI API request timed out after ${timeout} ms`)
              ),
            timeout
          )
        )
      ]);

      let parsed = completion.choices[0].message.parsed;

      // If the parsed value is a string (shouldn't be, but just in case), clean it
      if (typeof parsed === "string") {
        // Remove markdown code block if present
        const cleaned = parsed
          .replace(/^```(json)?/, "")
          .replace(/```$/, "")
          .trim();

        try {
          parsed = JSON.parse(cleaned);
        } catch (err) {
          this.logger.error(
            `Failed to parse JSON from OpenAI structured response: ${err}, raw response: ${cleaned.substring(0, 200)}...`
          );
          return {} as T;
        }
      }

      return parsed as T;
    } catch (error) {
      // Log the full error for debugging
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in OpenAI service: ${errorMessage}`);

      // Handle API errors - try to get APIError from the module
      if (error && typeof error === "object" && "status" in error) {
        this.logger.error(
          `OpenAI API Error: ${(error as any).status} - ${(error as any).message}`
        );
        this.logger.error(
          `Error details: ${JSON.stringify((error as any).error || {})}`
        );
      }

      throw new Error(`AI service error: ${errorMessage}`);
    }
  }
}
