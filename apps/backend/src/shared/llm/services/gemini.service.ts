import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";
import { Injectable, Logger } from "@nestjs/common";
import { ZodSchema } from "zod";
import { ConfigService } from "@/config/config.service";
import {
  AIServiceInterface,
  LLMOptions
} from "@/shared/llm/services/ai-service.interface";
import { Attachment } from "@/shared/llm/types/attachments";

// Import HarmCategory and HarmBlockThreshold from Google GenAI

@Injectable()
export class GeminiService implements AIServiceInterface {
  private readonly logger = new Logger(GeminiService.name);
  private readonly flashModel = "gemini-3-flash-preview";
  private readonly flashLiteModel = "gemini-2.5-flash";
  private geminiClient: GoogleGenAI | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Get the extraction model (normal flash for accuracy)
   */
  private get extractionModel(): string {
    return this.flashModel;
  }

  /**
   * Get the agent model (lite for cost efficiency on post-processing)
   */
  public getAgentModel(): string {
    return this.flashLiteModel;
  }

  /**
   * Get the normal (full) model for extraction
   */
  public getNormalModel(): string {
    return this.flashModel;
  }

  /**
   * Get the lite model for cost-efficient operations
   */
  public getLiteModel(): string {
    return this.flashLiteModel;
  }

  private get timeoutMs(): number {
    const v = Number(this.configService.get("LLM_TIMEOUT_MS"));
    return Number.isFinite(v) && v > 0
      ? Math.min(240000, Math.max(5000, Math.floor(v)))
      : 120000;
  }

  private get defaultTemperature(): number {
    const v = Number(this.configService.get("LLM_TEMPERATURE"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.2;
  }

  private get defaultMaxOutputTokens(): number {
    const v = Number(this.configService.get("LLM_MAX_OUTPUT_TOKENS_PRIMARY"));
    return Number.isFinite(v) && v > 0 ? Math.min(8192, Math.floor(v)) : 2048;
  }

  /**
   * Get max tokens based on task criticality
   * HIGH criticality tasks (extraction) get higher limits
   */
  private getMaxTokensForCriticality(
    criticality: string = "medium",
    override?: number
  ): number {
    if (override !== undefined) return override;
    // HIGH criticality tasks get 8192 for detailed extraction
    if (criticality === "high") return 8192;
    return this.defaultMaxOutputTokens;
  }

  /**
   * Lazily initialize the Gemini client.
   * Overrides global fetch with extended timeout to match Gemini Chat's processing capabilities.
   */
  private initializeClient() {
    if (!this.geminiClient) {
      const apiKey = this.configService.get("GEMINI_API_KEY");

      if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
        throw new Error(
          "GEMINI_API_KEY is required but not configured. Please set GEMINI_API_KEY in your .env file."
        );
      }

      // Ensure GOOGLE_APPLICATION_CREDENTIALS is not set to prevent ADC fallback
      // The SDK should use the API key exclusively
      const trimmedKey = apiKey.trim();

      // Explicitly set the API key in process.env to ensure SDK uses it
      // This prevents the SDK from trying to use Application Default Credentials
      if (!process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = trimmedKey;
      }

      // Override global fetch with extended timeout (5 minutes)
      // This removes the default 60-second Node.js fetch timeout that was causing failures
      // Gemini Chat has no such constraints, so we match its capabilities here
      const originalFetch = global.fetch;
      global.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

        return originalFetch(url, {
          ...init,
          signal: init?.signal || controller.signal
        }).finally(() => clearTimeout(timeout));
      }) as typeof fetch;

      this.geminiClient = new GoogleGenAI({ apiKey: trimmedKey });

      this.logger.log(
        "Gemini client initialized with custom 5-minute fetch timeout"
      );
    }
  }

  /**
   * Uploads an attachment to Gemini Files API via a temporary file.
   * Includes retry logic with exponential backoff for transient failures.
   */
  private async uploadToGemini(
    attachment: Attachment,
    retries = 3
  ): Promise<{ uri: string; mimeType: string }> {
    if (!attachment.buffer) {
      throw new Error("Cannot upload to Gemini: Buffer is missing");
    }

    const tempFilePath = path.join(
      os.tmpdir(),
      `gemini-${crypto.randomBytes(8).toString("hex")}.${this.getExtension(attachment.mimeType)}`
    );

    const fileSizeKB = Math.round(attachment.buffer.length / 1024);
    this.logger.log(
      `[Upload] Starting file upload: ${fileSizeKB} KB (${attachment.mimeType})`
    );
    console.log(
      `[Gemini Upload] Starting: ${fileSizeKB} KB, ${attachment.mimeType}`
    );

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Write buffer to temp file
        this.logger.log(
          `[Upload] Attempt ${attempt}/${retries}: Writing file to temp path`
        );
        fs.writeFileSync(tempFilePath, new Uint8Array(attachment.buffer));

        const uploadStartTime = Date.now();
        this.logger.log(`[Upload] Uploading file to Gemini API...`);
        console.log(`[Gemini Upload] Attempt ${attempt}: Uploading...`);

        const uploadedFile = await this.geminiClient!.files.upload({
          file: tempFilePath,
          config: { mimeType: attachment.mimeType }
        });

        const uploadDuration = Date.now() - uploadStartTime;

        if (!uploadedFile || !uploadedFile.uri || !uploadedFile.mimeType) {
          throw new Error(
            "Failed to get file URI or mimeType from Gemini upload response"
          );
        }

        this.logger.log(
          `[Upload] ✅ SUCCESS: File uploaded in ${uploadDuration}ms, URI: ${uploadedFile.uri}`
        );
        console.log(
          `[Gemini Upload] ✅ Success in ${uploadDuration}ms: ${uploadedFile.uri}`
        );

        return {
          uri: uploadedFile.uri,
          mimeType: uploadedFile.mimeType
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === retries;

        this.logger.warn(
          `[Upload] Attempt ${attempt}/${retries} failed: ${errorMsg}`
        );
        console.warn(`[Gemini Upload] Attempt ${attempt} failed: ${errorMsg}`);

        if (isLastAttempt) {
          this.logger.error(
            `[Upload] ❌ FAILED: All ${retries} upload attempts exhausted`
          );
          console.error(
            `[Gemini Upload] ❌ Failed after ${retries} attempts: ${errorMsg}`
          );
          throw new Error(
            `Gemini file upload failed after ${retries} attempts: ${errorMsg}`
          );
        }

        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        this.logger.log(
          `[Upload] Retrying in ${delayMs}ms... (attempt ${attempt + 1}/${retries})`
        );
        console.log(
          `[Gemini Upload] Retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries})...`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        // Clean up temp file
        if (fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
            this.logger.debug(`[Upload] Cleaned up temp file`);
          } catch {
            this.logger.warn(`[Upload] Failed to cleanup temp file`);
          }
        }
      }
    }

    throw new Error("Upload failed - should not reach here");
  }

  private getExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "application/pdf": "pdf"
    };
    return extensions[mimeType] || "bin";
  }

  /**
   * Build the user parts: prompt, buffers (as inlineData or fileData), then schema instructions (if any).
   */
  private async buildUserParts<T>(
    userPrompt: string,
    attachments: Attachment[] | undefined,
    responseSchema?: ZodSchema<T>
  ): Promise<any[]> {
    const parts: any[] = [];

    // 1) Append the user prompt first
    parts.push({ text: userPrompt });

    // 2) Append attachments
    if (attachments && attachments.length > 0) {
      // Upload files in parallel for efficiency
      const fileUris = await Promise.all(
        attachments.map(async (att) => {
          // Use Files API if we have a buffer (preferred for Gemini)
          // Fallback to inlineData if no buffer but we have base64 (legacy)
          if (att.buffer) {
            const file = await this.uploadToGemini(att);
            return { fileData: { fileUri: file.uri, mimeType: file.mimeType } };
          } else if (att.data) {
            return { inlineData: { data: att.data, mimeType: att.mimeType } };
          }
          return null;
        })
      );

      fileUris.forEach((part) => {
        if (part) parts.push(part);
      });
    }

    // 3) Append schema instructions last (if any)
    if (responseSchema) {
      parts.push({
        text:
          "You MUST respond with ONLY a JSON object that matches this structure:\n" +
          JSON.stringify((responseSchema as any)._def, null, 2) +
          "\nNo extra text or explanation."
      });
    }

    return parts;
  }

  /**
   * Send a prompt to Gemini with optional Zod schema validation.
   * @param systemMessage The system message to set context for the assistant.
   * @param humanMessage The user prompt (text).
   * @param responseSchema Optional Zod schema for structured output.
   * @param attachments Optional attachments (images, etc.)
   * @param model Optional model to use (defaults to configured extraction model)
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
    const useModel = model ?? this.extractionModel;

    // Determine parameters from options or defaults
    const temperature = options?.temperature ?? this.defaultTemperature;
    const maxOutputTokens = this.getMaxTokensForCriticality(
      "high",
      options?.maxOutputTokens
    );
    const timeout = options?.timeout ?? this.timeoutMs;

    try {
      const contents = [
        {
          role: "user",
          parts: await this.buildUserParts(
            userPrompt,
            attachments,
            responseSchema
          )
        }
      ];

      // Call Gemini API with timeout and retry logic
      const maxRetries = 2; // 2 retries = 3 total attempts
      let lastError: Error | null = null;
      let response: any = null;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          this.logger.log(
            `[Generation] Attempt ${attempt}/${maxRetries + 1}: Calling Gemini API...`
          );
          console.log(`[Gemini Generation] Attempt ${attempt}: Starting...`);

          response = await Promise.race([
            this.geminiClient!.models.generateContent({
              model: useModel,
              contents,
              config: {
                systemInstruction: systemPrompt,
                temperature,
                maxOutputTokens,
                ...(responseSchema
                  ? { responseMimeType: "application/json" }
                  : {})
              }
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Gemini API request timed out after ${timeout} ms`
                    )
                  ),
                timeout
              )
            )
          ]);

          this.logger.log(`[Generation] ✅ Attempt ${attempt} succeeded`);
          console.log(`[Gemini Generation] ✅ Attempt ${attempt} succeeded`);
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorMsg = lastError.message;

          this.logger.warn(
            `[Generation] Attempt ${attempt}/${maxRetries + 1} failed: ${errorMsg}`
          );
          console.log(
            `[Gemini Generation] Attempt ${attempt} failed: ${errorMsg}`
          );

          if (attempt === maxRetries + 1) {
            // Last attempt failed, throw
            throw lastError;
          }

          // Exponential backoff before retry
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          this.logger.warn(`[Generation] Retrying in ${delay}ms...`);
          console.log(`[Gemini Generation] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Extract text response - handle multi-part responses properly
      let textResponse = "";

      // Gemini may return responses with multiple parts (thinking, text, etc.)
      // We need to extract all text parts and combine them
      if (response?.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];

        if (candidate.content?.parts) {
          // Extract text from all parts
          const textParts: string[] = [];

          for (const part of candidate.content.parts) {
            if (part.text) {
              textParts.push(part.text);
            }
            // Log non-text parts for debugging
            else if (part.thoughtSignature) {
              this.logger.debug(
                `Gemini returned thinking/reasoning part (ignored)`
              );
            }
          }

          textResponse = textParts.join("\n").trim();

          this.logger.debug(
            `Extracted text from ${candidate.content.parts.length} parts, ` +
              `${textParts.length} text parts, total length: ${textResponse.length}`
          );
        }
      }

      // Fallback to .text property if parts extraction failed
      if (!textResponse && response?.text) {
        textResponse = response.text;
        this.logger.debug(
          `Using response.text fallback, length: ${textResponse.length}`
        );
      }

      if (!textResponse || textResponse.trim().length === 0) {
        this.logger.warn(
          `Empty response from Gemini after extracting all parts`
        );
        if (responseSchema) {
          throw new Error("Gemini returned empty response for structured output request");
        }
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

          if (!cleaned) {
            throw new Error("Response is empty after cleaning markdown");
          }

          try {
            const parsed = JSON.parse(cleaned);
            return responseSchema.parse(parsed);
          } catch (parseError) {
            this.logger.error(
              `Failed to parse response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
            this.logger.error(`Response preview: ${cleaned.substring(0, 500)}`);
            throw new Error(
              `JSON parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }
        } catch (err) {
          this.logger.error(
            `Response validation failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          throw err;
        }
      }

      return textResponse;
    } catch (error) {
      this.logger.error(
        `Gemini API error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw new Error(
        `Gemini request failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
