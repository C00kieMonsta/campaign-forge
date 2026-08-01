import { Injectable } from "@nestjs/common";
import {
  BULK_TIER,
  DEFAULT_DEPTH,
  DEPTHS,
  MODELS,
  type ModelTier,
  type ReasoningDepth,
  type ReasoningEffort
} from "@packages/types";
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
    /**
     * Route to the cheap tier. Set it for MECHANICAL passes — extract a verbatim quote, summarise one
     * document, build a digest — which run hundreds of times per job and gain nothing from a frontier
     * model. An adverse-case run alone makes up to 224 such calls.
     *
     * Never set it for anything a lawyer reads or that gates a citation: the entailment judge in
     * VerificationService is cheap to run and expensive to get wrong.
     */
    fast?: boolean;
    /** How hard to think. Ignored when `fast` — deliberation on "copy this quote" buys nothing. */
    depth?: ReasoningDepth;
  }): Promise<string> {
    const client = await this.getClient();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (params.system)
      messages.push({ role: "system", content: params.system });
    messages.push({ role: "user", content: params.user });

    const res = await client.chat.completions.create({
      ...this.request(params.fast ? BULK_TIER : undefined, params.depth),
      messages,
      max_tokens: params.maxTokens,
      ...(params.json
        ? { response_format: { type: "json_object" as const } }
        : {})
    });
    return res.choices[0]?.message?.content ?? "";
  }

  /**
   * Model and reasoning fields for a call, resolved from the registry.
   *
   * An explicit `tier` wins (the bulk passes), otherwise the depth decides both. Capability-driven
   * throughout: reasoning_effort is only sent to a model that accepts it, and `temperature` is never
   * sent at all — see the note on streamChat. One model for everything was wrong in both directions,
   * a frontier model doing 224 quote extractions and a cheap one doing what gets filed.
   */
  private request(
    tier?: ModelTier,
    depth: ReasoningDepth = DEFAULT_DEPTH
  ): { model: string; reasoning_effort?: ReasoningEffort } {
    const chosen = tier ?? DEPTHS[depth].tier;
    const model = MODELS[chosen];
    // The bulk tier is asked for by tier, not by depth, so it gets the floor rather than the
    // depth's effort: its job is mechanical. "low" rather than "none" because the pinned SDK does
    // not type "none" — see the note in the registry.
    const effort: ReasoningEffort =
      tier === BULK_TIER ? "low" : DEPTHS[depth].effort;
    return {
      model: model.id,
      ...(model.supportsReasoningEffort ? { reasoning_effort: effort } : {})
    };
  }

  /**
   * Streams a chat completion, yielding content deltas as they arrive.
   *
   * NO TEMPERATURE, here or in complete() — and that is now recorded as `supportsTemperature: false`
   * in the model registry rather than assumed here. The reasoning models reject anything but their
   * default —
   * "Unsupported value: 'temperature' does not support 0 with this model" — so the parameter this
   * codebase used to pin to 0 is simply gone. The determinism those call sites were reaching for is
   * no longer available through it: two runs of the same assessment may now differ in wording. What
   * still holds is what actually mattered — every quote is gated against the stored text, so a run
   * can phrase a finding differently but cannot invent one.
   */
  async *streamChat(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    opts: { depth?: ReasoningDepth } = {}
  ): AsyncGenerator<string> {
    const client = await this.getClient();
    const stream = await client.chat.completions.create({
      // A caller may raise the depth for one turn — a filed assessment deserves more deliberation
      // than a question about which piece mentions a date.
      ...this.request(undefined, opts.depth),
      messages,
      stream: true
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
