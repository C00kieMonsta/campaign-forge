import { Injectable, Logger } from "@nestjs/common";
import {
  BULK_TIER,
  completionBudget,
  DEFAULT_DEPTH,
  DEPTHS,
  MODELS,
  type ModelDefinition,
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
 * Every field this app is allowed to put on a chat-completion request.
 *
 * An ALLOW-LIST rather than a convention, because with this model family the parameters that are
 * rejected outnumber the ones accepted, and each rejection is a 400 that takes a feature down
 * rather than a warning that degrades it. Two have already fired in production — `temperature`
 * ("does not support 0 with this model") and `max_tokens` ("use max_completion_tokens instead").
 *
 * The spec asserts the emitted keys are a subset of this set, so adding a parameter at a call site
 * fails a test rather than a court-document run.
 */
export const ALLOWED_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  "model",
  "messages",
  "reasoning_effort",
  "max_completion_tokens",
  "max_tokens",
  "response_format",
  "stream",
  // Only meaningful with `stream: true`. It is what makes the final chunk carry `usage`, which is
  // the only place the API reports prompt_tokens and cached_tokens for a streamed call — see the
  // usage log in streamChat.
  "stream_options"
]);

/**
 * Characters in the assembled prompt, which is what the estimate in shared/tokens.ts is computed
 * from — so dividing this by the API's reported prompt_tokens gives the measured chars-per-token.
 *
 * Non-string content blocks count 0. This app never builds one, and a telemetry helper must not be
 * able to throw on the path that produces a legal answer.
 */
function promptChars(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): number {
  return messages.reduce(
    (total, m) =>
      total + (typeof m.content === "string" ? m.content.length : 0),
    0
  );
}

/**
 * A stream that ended without saying "stop": truncated, filtered, or empty.
 *
 * A distinct type rather than a generic Error because the consumers treat it differently from a
 * network failure — the text that arrived before it is real and worth keeping, it just must never
 * be presented as the finished answer. Everything on the streaming path is something a lawyer
 * reads: a chat reply, or the assessment a filing gets argued from.
 */
export class StreamIncompleteError extends Error {
  constructor(
    /** The API's finish_reason, or "empty" when the stream carried no content at all. */
    readonly reason: string,
    /** Characters that did arrive, so a caller can decide whether the fragment is worth keeping. */
    readonly produced: number
  ) {
    super(
      reason === "empty"
        ? "The model returned no content at all"
        : `The model stopped early (${reason}) after ${produced} characters`
    );
    this.name = "StreamIncompleteError";
  }
}

/**
 * The model and reasoning fields for one call, derived from what the model DECLARES it accepts.
 *
 * Shared by the streaming and non-streaming paths deliberately. They used to build their own, which
 * is how `max_tokens` survived on one of them: a capability honoured in one builder and forgotten in
 * the other is the same bug with a longer fuse.
 *
 * `temperature` is absent and stays absent — every model in the registry declares
 * `supportsTemperature: false`, and there is no caller that wants one. Its enforcement is the
 * allow-list above plus the spec, not a runtime branch over a parameter nobody sends.
 */
export function requestFields(
  model: ModelDefinition,
  effort: ReasoningEffort,
  budget: number | undefined
): {
  model: string;
  reasoning_effort?: ReasoningEffort;
  max_tokens?: number;
  max_completion_tokens?: number;
} {
  const fields: ReturnType<typeof requestFields> = { model: model.id };
  if (model.supportsReasoningEffort) fields.reasoning_effort = effort;
  // Indexed by the registry, never by a literal — that literal was the outage.
  if (budget !== undefined) fields[model.maxTokensParam] = budget;
  return fields;
}

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
  // A field, not a constructor injection: the spec builds this service as
  // `new OpenAiService({} as never, {} as never)` and a third parameter would break every one of
  // those cases for a logger.
  private readonly logger = new Logger(OpenAiService.name);

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

    const { model, effort } = this.resolve(
      params.fast ? BULK_TIER : undefined,
      params.depth
    );
    // The ceiling covers the model's reasoning as well as its prose, so the caller's budget gets an
    // allowance added on top — see completionBudget. The FIELD NAME comes from the registry: the
    // reasoning models 400 on `max_tokens`, which took down every adverse-case run.
    const budget = completionBudget(params.maxTokens, effort);

    const res = await client.chat.completions.create({
      ...requestFields(model, effort, budget),
      messages,
      ...(params.json
        ? { response_format: { type: "json_object" as const } }
        : {})
    });

    const choice = res.choices[0];
    // A truncated completion is NOT an empty answer, and returning "" for one is how a document
    // ends up with zero claims and nobody can say why. Downstream this string is JSON.parsed or
    // stored as a legal summary; both would accept the silence. Fail with the numbers needed to fix
    // it — usually the reasoning allowance, not the caller's prose budget.
    if (choice?.finish_reason === "length") {
      const used = res.usage?.completion_tokens_details?.reasoning_tokens;
      throw new Error(
        `OpenAI truncated the completion (model ${model.id}, effort ${effort}, ` +
          `budget ${budget ?? "unset"} tokens` +
          (typeof used === "number" ? `, ${used} spent on reasoning` : "") +
          `). Raise maxTokens at the call site or REASONING_ALLOWANCE in the model registry.`
      );
    }
    return choice?.message?.content ?? "";
  }

  /**
   * Which model a call runs on and how hard it thinks, resolved from the registry.
   *
   * An explicit `tier` wins (the bulk passes), otherwise the depth decides both. The MODEL is
   * returned rather than just its id because callers need its capabilities too — the token-ceiling
   * parameter is named differently on the reasoning models, and getting that wrong is a 400.
   * One model for everything was wrong in both directions: a frontier model doing 224 quote
   * extractions, and a cheap one doing what gets filed.
   */
  private resolve(
    tier?: ModelTier,
    depth: ReasoningDepth = DEFAULT_DEPTH
  ): { model: ModelDefinition; effort: ReasoningEffort } {
    const chosen = tier ?? DEPTHS[depth].tier;
    // The bulk tier is asked for by tier, not by depth, so it gets the floor rather than the
    // depth's effort: its job is mechanical. "low" rather than "none" because the pinned SDK does
    // not type "none" — see the note in the registry.
    const effort: ReasoningEffort =
      tier === BULK_TIER ? "low" : DEPTHS[depth].effort;
    return { model: MODELS[chosen], effort };
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
    opts: {
      depth?: ReasoningDepth;
      /**
       * Which feature made this call. Two very different callers stream — a chat turn and a
       * background assessment synthesis — and mixing their numbers in one log makes the cache
       * figures meaningless, since only the chat path repeats a prefix at all.
       */
      caller?: string;
      /**
       * Which prompt blocks the assembler put in, in order. Cache hit rate is uninterpretable
       * without it: a turn with no APPLICABLE LAW block has a different prefix from one with it,
       * and reads as a cache miss for a reason that has nothing to do with block ordering.
       */
      blocks?: string[];
    } = {}
  ): AsyncGenerator<string> {
    const client = await this.getClient();
    // A caller may raise the depth for one turn — a filed assessment deserves more deliberation
    // than a question about which piece mentions a date.
    const { model, effort } = this.resolve(undefined, opts.depth);
    const stream = await client.chat.completions.create({
      ...requestFields(model, effort, undefined),
      messages,
      stream: true,
      // Makes the final chunk carry `usage`. Without it a streamed call reports nothing at all,
      // which is why this app had no measured token figure anywhere.
      stream_options: { include_usage: true }
    });
    // The terminal reason arrives on the LAST chunk, after the content. Discarding it is how a
    // stream that stopped mid-sentence — the model's own ceiling, or a content filter tripping on
    // quoted material from a case file — got persisted as a finished legal answer.
    let finish: string | null = null;
    let produced = 0;
    let usage: OpenAI.CompletionUsage | undefined;
    try {
      for await (const chunk of stream) {
        // The usage chunk arrives with `choices: []`, so it must not be read as content and must
        // not clobber the finish_reason captured from the chunk before it.
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (delta) {
          produced += delta.length;
          yield delta;
        }
      }
    } finally {
      // In a `finally` because the interesting turns are the ones that do not reach the end: the
      // truncations below throw, and an SSE disconnect abandons the generator mid-iteration. Both
      // would otherwise be exactly the turns with no usage data.
      this.logUsage(model.id, promptChars(messages), produced, usage, opts);
    }

    // Thrown AFTER everything has been yielded, so a consumer that wants to keep what arrived
    // already holds it and can persist it as visibly incomplete rather than as the answer.
    if (finish !== null && finish !== "stop") {
      throw new StreamIncompleteError(finish, produced);
    }
    if (produced === 0) {
      throw new StreamIncompleteError("empty", 0);
    }
  }

  /**
   * Records what one streamed call actually cost, in the API's own numbers rather than this app's
   * estimate of them.
   *
   * Two things are being measured, and neither had any figure before this.
   *
   * `charsPerToken` is the measured ratio for this app's own FR/NL legal prose on the model
   * actually in use. It is the number to calibrate shared/tokens.ts CHARS_PER_TOKEN against: if
   * this log says 3.0, every budget in the app is over-filling by 12% and MAX_TURN_TOKENS is not
   * the ceiling it claims to be.
   *
   * `cachedTokens` is what OpenAI served from its automatic prompt cache. Caching only engages
   * from 1024 prompt tokens and keys on an exact prefix, so a short turn reports 0 for reasons
   * unrelated to how the blocks are ordered — read it together with `promptTokens` and `blocks`,
   * never on its own.
   */
  private logUsage(
    modelId: string,
    promptChars: number,
    producedChars: number,
    usage: OpenAI.CompletionUsage | undefined,
    opts: { caller?: string; blocks?: string[] }
  ): void {
    const promptTokens = usage?.prompt_tokens;
    this.logger.log(
      JSON.stringify({
        action: "lexModelUsage",
        caller: opts.caller ?? "unknown",
        model: modelId,
        blocks: opts.blocks?.join(",") ?? null,
        promptTokens: promptTokens ?? null,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        producedChars,
        charsPerToken:
          promptTokens && promptChars
            ? Number((promptChars / promptTokens).toFixed(2))
            : null
      })
    );
  }
}
