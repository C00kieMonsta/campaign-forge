import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ZodSchema } from "zod";
import { ConfigService } from "@/config/config.service";
import {
  AIServiceInterface,
  LLMOptions
} from "@/shared/llm/services/ai-service.interface";
import { Attachment } from "@/shared/llm/types/attachments";

@Injectable()
export class AnthropicService implements AIServiceInterface {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly defaultModel = "claude-sonnet-4-5-20250929";
  private anthropicAIClient: Anthropic | null = null;

  constructor(private readonly configService: ConfigService) {}

  private get timeoutMs(): number {
    const v = Number(this.configService.get("LLM_TIMEOUT_MS"));
    return Number.isFinite(v) && v > 0
      ? Math.min(120000, Math.max(5000, Math.floor(v)))
      : 45000;
  }

  private get defaultMaxTokens(): number {
    const v = Number(this.configService.get("LLM_MAX_OUTPUT_TOKENS_PRIMARY"));
    return Number.isFinite(v) && v > 0 ? Math.min(8192, Math.floor(v)) : 2048;
  }

  /**
   * Lazily initialize the OpenAI client.
   */
  private initializeClient() {
    if (!this.anthropicAIClient) {
      const apiKey = this.configService.get("ANTHROPIC_API_KEY");
      this.anthropicAIClient = new Anthropic({
        apiKey
      });
    }
  }

  // Attachments are already base64 + mime in the LLM layer

  /**
   * Send a prompt to Anthropic with optional Zod schema validation.
   * @param systemMessage The system message to set context for the assistant.
   * @param humanMessage The user prompt (text).
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments (images, etc.).
   * @param model Optional model to use (defaults to claude-sonnet-4-5-20250929).
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
    this.initializeClient();
    const useModel = model ?? this.defaultModel;

    const maxTokens = options?.maxOutputTokens ?? this.defaultMaxTokens;
    const timeout = options?.timeout ?? this.timeoutMs;

    try {
      // Prepare content blocks
      const content: any[] = [];

      // Add all attachments (images)
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.data && att.mimeType) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.mimeType as any,
                data: att.data
              }
            });
          }
        }
      }

      content.push({ type: "text", text: userPrompt });

      // Optionally append schema instructions to the system message
      let finalSystemMessage = systemPrompt;
      if (responseSchema) {
        finalSystemMessage +=
          "\n\nYou MUST respond with ONLY a JSON object that matches this structure:\n" +
          JSON.stringify(responseSchema._def, null, 2) +
          "\nNo extra text or explanation.";
      }

      // Call Anthropic API with timeout
      const response = await Promise.race([
        this.anthropicAIClient!.messages.create({
          model: useModel,
          max_tokens: maxTokens,
          system: finalSystemMessage,
          messages: [
            {
              role: "user",
              content
            }
          ]
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Anthropic API request timed out after ${timeout} ms`)
              ),
            timeout
          )
        )
      ]);

      // Extract text response with better error handling
      let textResponse = "";
      if (response.content && response.content.length > 0) {
        if (response.content[0].type === "text") {
          textResponse = response.content[0].text;
        } else {
          this.logger.warn(
            `Unexpected content type: ${response.content[0].type}`
          );
          return ""; // Return empty string instead of throwing error
        }
      } else {
        this.logger.warn("Empty content array in Anthropic response");
        return "";
      }

      // If schema is provided, validate and parse
      if (responseSchema) {
        try {
          // Remove markdown code block if present
          const cleaned = textResponse
            .replace(/^```(json)?/, "")
            .replace(/```$/, "")
            .trim();

          // Handle empty response
          if (!cleaned) {
            this.logger.warn(
              "Empty response from Claude when expecting structured data"
            );
            return {} as T;
          }

          try {
            const parsed = JSON.parse(cleaned);
            return responseSchema.parse(parsed);
          } catch (parseError) {
            this.logger.error(
              `Failed to parse JSON: ${parseError}, raw response: ${cleaned.substring(0, 200)}...`
            );
            return {} as T;
          }
        } catch (err) {
          this.logger.error(
            `Failed to parse/validate structured response: ${err}`
          );
          return {} as T; // Return empty object instead of throwing
        }
      }

      return textResponse;
    } catch (error) {
      this.logger.error(`Anthropic API error: ${error}`);
      const hasSchema = !!responseSchema;
      if (hasSchema) {
        return {} as T;
      }
      return "";
    }
  }
}
