import { ZodSchema } from "zod";
import { Attachment } from "@/shared/llm/types/attachments";

export interface LLMOptions {
  temperature?: number;
  maxOutputTokens?: number;
  timeout?: number;
}

export interface AIServiceInterface {
  /**
   * Send a prompt with optional binary context and structured output.
   * @param systemPrompt System message for the assistant
   * @param userPrompt User message/prompt
   * @param responseSchema Optional Zod schema for structured output
   * @param attachments Optional attachments (e.g., images, pdf, audio)
   * @param model Optional model to use
   * @param options Optional LLM options (temperature, maxOutputTokens, timeout)
   */
  ask<T>(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: ZodSchema<T>,
    attachments?: Attachment[],
    model?: string,
    options?: LLMOptions
  ): Promise<T | string>;
}
