import { Mistral } from "@mistralai/mistralai";
import * as components from "@mistralai/mistralai/models/components";
import { Injectable, Logger } from "@nestjs/common";
import { ZodSchema } from "zod";
import { ConfigService } from "@/config/config.service";
import { AIServiceInterface } from "@/shared/llm/services/ai-service.interface";
import { Attachment } from "@/shared/llm/types/attachments";

export enum MistralModel {
  LARGE = "mistral-large-latest",
  PIXTRAL = "pixtral-large-latest"
}

@Injectable()
export class MistralService implements AIServiceInterface {
  private readonly logger = new Logger(MistralService.name);
  private mistralClient: Mistral | null = null;

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
   * Lazily initialize the Mistral client.
   */
  private initializeClient() {
    if (!this.mistralClient) {
      const apiKey = this.configService.getString("MISTRAL_API_KEY");
      if (!apiKey) {
        throw new Error("MISTRAL_API_KEY is not configured");
      }

      this.mistralClient = new Mistral({
        apiKey
      });
    }
  }

  /**
   * Send a prompt to Mistral with optional Zod schema validation.
   * @param systemPrompt The system message to set context for the assistant.
   * @param userPrompt The user prompt (text).
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments (images, etc.)
   * @returns The response as a structured object or plain string.
   */
  async ask<T>(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: ZodSchema<T>,
    attachments?: Attachment[]
  ): Promise<T | string> {
    return this.askWithModel(
      systemPrompt,
      userPrompt,
      responseSchema,
      attachments,
      MistralModel.LARGE
    );
  }

  /**
   * Send a prompt to Mistral with a specific model.
   * @param systemPrompt The system message to set context for the assistant.
   * @param userPrompt The user prompt (text).
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments (images, etc.)
   * @param model The model to use (defaults to LARGE)
   * @returns The response as a structured object or plain string.
   */
  async askWithModel<T>(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: ZodSchema<T>,
    attachments?: Attachment[],
    model: MistralModel = MistralModel.LARGE
  ): Promise<T | string> {
    try {
      this.initializeClient();
    } catch (initError) {
      this.logger.error(`Failed to initialize Mistral client: ${initError}`);
      throw new Error(
        `Mistral client initialization failed: ${initError instanceof Error ? initError.message : String(initError)}`
      );
    }

    try {
      // Prepare messages array with proper types
      const messages: Array<
        | (components.SystemMessage & { role: "system" })
        | (components.UserMessage & { role: "user" })
      > = [{ role: "system", content: systemPrompt }];

      // Handle attachments - Mistral supports images
      if (attachments && attachments.length > 0) {
        const content: Array<components.ContentChunk> = [];

        // Add text content
        content.push({
          type: "text",
          text: userPrompt
        });

        // Add image attachments
        for (const attachment of attachments) {
          if (attachment.data && attachment.mimeType?.startsWith("image/")) {
            content.push({
              type: "image_url",
              imageUrl: `data:${attachment.mimeType};base64,${attachment.data}`
            });
          }
        }

        messages.push({ role: "user", content });
      } else {
        messages.push({ role: "user", content: userPrompt });
      }

      // Optionally append schema instructions for structured output
      if (responseSchema) {
        messages[0].content =
          systemPrompt +
          "\n\nYou MUST respond with ONLY a JSON object that matches this structure:\n" +
          JSON.stringify(responseSchema._def, null, 2) +
          "\nNo extra text or explanation.";
      }

      // Call Mistral API with timeout
      if (!this.mistralClient) {
        throw new Error("Mistral client is not initialized");
      }

      const response = await Promise.race([
        this.mistralClient.chat.complete({
          model,
          messages,
          temperature: this.defaultTemperature,
          maxTokens: this.defaultMaxTokens
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Mistral API request timed out after ${this.timeoutMs} ms`
                )
              ),
            this.timeoutMs
          )
        )
      ]);

      // Extract text response
      let textResponse = "";
      if (response.choices && response.choices.length > 0) {
        const choice = response.choices[0];
        if (choice.message?.content) {
          // Handle both string and ContentChunk[] types
          if (typeof choice.message.content === "string") {
            textResponse = choice.message.content;
          } else if (Array.isArray(choice.message.content)) {
            // Extract text from ContentChunk array
            textResponse = choice.message.content
              .filter(
                (chunk): chunk is components.ContentChunk & { text: string } =>
                  "text" in chunk && typeof chunk.text === "string"
              )
              .map((chunk) => chunk.text)
              .join("");
          }
        } else {
          this.logger.warn("Empty message content in Mistral response");
          return responseSchema ? ({} as T) : "";
        }
      } else {
        this.logger.warn("No choices in Mistral response");
        return responseSchema ? ({} as T) : "";
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
              "Empty response from Mistral when expecting structured data"
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
          return {} as T;
        }
      }

      return textResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Provide specific guidance for common API issues
      if (
        errorMessage.includes("401") ||
        errorMessage.includes("Unauthorized")
      ) {
        this.logger.error(
          `Mistral API authentication failed: Invalid or missing API key. Please check your MISTRAL_API_KEY environment variable.`
        );
        throw new Error(
          `Mistral API authentication failed: Invalid or missing API key. Please verify your MISTRAL_API_KEY is correct.`
        );
      } else if (
        errorMessage.includes("403") ||
        errorMessage.includes("Forbidden")
      ) {
        this.logger.error(
          `Mistral API access forbidden: API key may not have sufficient permissions.`
        );
        throw new Error(
          `Mistral API access forbidden: API key may not have sufficient permissions.`
        );
      } else if (
        errorMessage.includes("Invalid model") ||
        errorMessage.includes("1500")
      ) {
        this.logger.error(
          `Mistral API model error: ${errorMessage}. The requested model may not be available or accessible with your API key.`
        );
        throw new Error(
          `Mistral API model error: The requested model is not available. Falling back to vision-only extraction.`
        );
      } else if (
        errorMessage.includes("429") ||
        errorMessage.includes("rate limit")
      ) {
        this.logger.error(
          `Mistral API rate limit exceeded. Please try again later.`
        );
        throw new Error(
          `Mistral API rate limit exceeded. Please try again later.`
        );
      } else if (
        errorMessage.includes("520") ||
        errorMessage.includes("Web server is returning an unknown error")
      ) {
        this.logger.error(
          `Mistral API server error (520): Infrastructure issue on Mistral's side. This is temporary and should resolve automatically.`
        );
        throw new Error(
          `Mistral API server error: Infrastructure issue (not your fault). Falling back to vision-only extraction.`
        );
      } else if (
        errorMessage.includes("502") ||
        errorMessage.includes("503") ||
        errorMessage.includes("504")
      ) {
        this.logger.error(
          `Mistral API server error (${errorMessage.includes("502") ? "502" : errorMessage.includes("503") ? "503" : "504"}): Service temporarily unavailable.`
        );
        throw new Error(
          `Mistral API server error: Service temporarily unavailable. Falling back to vision-only extraction.`
        );
      } else {
        this.logger.error(`Mistral API error: ${errorMessage}`);
        throw new Error(`Mistral API error: ${errorMessage}`);
      }
    }
  }

  /**
   * Convenience method for OCR tasks using the pixtral-large-latest model with vision capabilities.
   * @param systemPrompt The system message to set context for the assistant.
   * @param userPrompt The user prompt (text).
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments (images, etc.)
   * @returns The response as a structured object or plain string.
   */
  async askOCR<T>(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: ZodSchema<T>,
    attachments?: Attachment[]
  ): Promise<T | string> {
    return this.askWithModel(
      systemPrompt,
      userPrompt,
      responseSchema,
      attachments,
      MistralModel.PIXTRAL
    );
  }

  /**
   * Convenience method for general tasks using the mistral-large-latest model.
   * @param systemPrompt The system message to set context for the assistant.
   * @param userPrompt The user prompt (text).
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments (images, etc.)
   * @returns The response as a structured object or plain string.
   */
  async askLarge<T>(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: ZodSchema<T>,
    attachments?: Attachment[]
  ): Promise<T | string> {
    return this.askWithModel(
      systemPrompt,
      userPrompt,
      responseSchema,
      attachments,
      MistralModel.LARGE
    );
  }
}
