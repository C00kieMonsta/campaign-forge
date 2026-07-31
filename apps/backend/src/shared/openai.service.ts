import { Injectable } from "@nestjs/common";
import OpenAI, { toFile } from "openai";
import { ConfigService } from "../config/config.service";
import { SecretsService } from "./secrets.service";

/** The transcription endpoint rejects payloads above 25 MB — checked before we spend the call. */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

/**
 * Lazy OpenAI client. The API key is resolved on first use from either OPENAI_API_KEY
 * (local dev) or OPENAI_API_KEY_SECRET_ARN via Secrets Manager (prod) — never at boot,
 * so a missing key can't crash the shared process.
 *
 * Phase 0 provides embeddings (needed by Phase 2 ingestion). Chat/streaming/rerank land
 * with the conversation subsystem in Phase 3.
 */
@Injectable()
export class OpenAiService {
  private client?: OpenAI;

  constructor(
    private config: ConfigService,
    private secrets: SecretsService
  ) {}

  private async getClient(): Promise<OpenAI> {
    if (this.client) return this.client;
    this.client = new OpenAI({ apiKey: await this.resolveApiKey() });
    return this.client;
  }

  private async resolveApiKey(): Promise<string> {
    const direct = this.config.get("OPENAI_API_KEY");
    if (direct) return direct;

    const arn = this.config.get("OPENAI_API_KEY_SECRET_ARN");
    if (arn) {
      const secret = await this.secrets.getSecretString(arn);
      // The secret may be a raw key or a JSON blob like {"OPENAI_API_KEY":"sk-..."}.
      try {
        const parsed = JSON.parse(secret) as { OPENAI_API_KEY?: unknown };
        if (typeof parsed.OPENAI_API_KEY === "string")
          return parsed.OPENAI_API_KEY;
      } catch {
        /* not JSON — treat as a raw key */
      }
      return secret;
    }

    throw new Error(
      "OpenAI is not configured — set OPENAI_API_KEY or OPENAI_API_KEY_SECRET_ARN"
    );
  }

  /** Embeds one or more strings with the configured embedding model (text-embedding-3-large, 3072 dims). */
  async embed(input: string | string[]): Promise<number[][]> {
    const client = await this.getClient();
    const res = await client.embeddings.create({
      model: this.config.get("OPENAI_EMBEDDING_MODEL"),
      dimensions: this.config.get("OPENAI_EMBEDDING_DIMENSIONS"),
      input
    });
    return res.data.map((d) => d.embedding);
  }

  /**
   * Transcribes an audio buffer (voice notes) with the configured transcription model
   * (whisper-1 by default). `verbose_json` also gives us the clip duration, which the UI shows
   * next to the note. The language is auto-detected — voice notes are FR/NL/EN in practice.
   */
  async transcribe(
    buffer: Buffer,
    filename: string,
    contentType?: string
  ): Promise<{ text: string; durationSeconds: number | null }> {
    if (buffer.length > MAX_TRANSCRIBE_BYTES) {
      throw new Error(
        `Audio is too large to transcribe (${Math.round(buffer.length / 1024 / 1024)} MB, max 25 MB)`
      );
    }
    const client = await this.getClient();
    const file = await toFile(buffer, filename, {
      type: contentType || "audio/webm"
    });
    const res = await client.audio.transcriptions.create({
      file,
      model: this.config.get("OPENAI_TRANSCRIBE_MODEL"),
      response_format: "verbose_json"
    });
    return {
      text: res.text ?? "",
      durationSeconds:
        typeof res.duration === "number" ? Math.round(res.duration) : null
    };
  }

  /**
   * Non-streaming chat completion. Used by Phase 2 for per-document summarization + date
   * extraction. Pass `json: true` to force a JSON-object response. (Streaming lands in Phase 3.)
   */
  async complete(params: {
    user: string;
    system?: string;
    json?: boolean;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const client = await this.getClient();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (params.system)
      messages.push({ role: "system", content: params.system });
    messages.push({ role: "user", content: params.user });

    const res = await client.chat.completions.create({
      model: this.config.get("OPENAI_CHAT_MODEL"),
      messages,
      temperature: params.temperature ?? 0,
      max_tokens: params.maxTokens,
      ...(params.json
        ? { response_format: { type: "json_object" as const } }
        : {})
    });
    return res.choices[0]?.message?.content ?? "";
  }

  /** Streams a chat completion, yielding content deltas as they arrive (Phase 3 chat). */
  async *streamChat(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    opts: { temperature?: number } = {}
  ): AsyncGenerator<string> {
    const client = await this.getClient();
    const stream = await client.chat.completions.create({
      model: this.config.get("OPENAI_CHAT_MODEL"),
      messages,
      temperature: opts.temperature ?? 0.2,
      stream: true
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
