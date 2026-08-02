// The models this app runs on, and what each one is for.
//
// A code table rather than configuration. Model ids change often, their capabilities differ in ways
// that break requests rather than degrade them, and an SSM parameter per environment is a way for
// staging and production to quietly disagree about which model wrote a court document. Here, the
// choice is reviewable in a diff and identical everywhere.
//
// It also carries CAPABILITIES, which is the part that earns the file. Switching to gpt-5.6 broke
// every completion in the app because the reasoning models reject `temperature` — "Unsupported
// value: 'temperature' does not support 0 with this model" — and the codebase pinned it to 0 in four
// places. That is not something to remember; it is a field.
//
// Verified against the live /v1/models endpoint and by a real call to each id on 2026-08-01.

/**
 * What a call needs, not which model to use.
 *
 * Call sites name the WORK — is this something a lawyer reads, or is it the four-hundredth quote
 * extraction of a batch? — and the tier decides the model. A call site naming a model id would have
 * to be revisited every time the roster moves.
 */
export type ModelTier = "fast" | "balanced" | "deep";

/**
 * How hard the model should think. Maps straight to the API's reasoning_effort.
 *
 * The API also accepts "none" and "max", but the pinned openai SDK types this union as
 * low|medium|high — so those two are deliberately absent rather than cast past the type checker.
 * Widening it is an SDK upgrade, not an edit here.
 */
export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelDefinition {
  id: string;
  tier: ModelTier;
  /** The vendor's own description, so the reason for the tier is traceable. */
  purpose: string;
  contextTokens: number;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  /**
   * False for the reasoning models, which accept only their default. Requests must OMIT the
   * parameter entirely rather than send a default — sending temperature:1 explicitly is also
   * rejected by some, and the app has no reason to set it at all.
   */
  supportsTemperature: boolean;
  supportsReasoningEffort: boolean;
  /**
   * What this model calls the output ceiling.
   *
   * The reasoning models renamed it: sending `max_tokens` is a 400, not a warning — "Unsupported
   * parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
   * It took down every adverse-case run. The NAME is stored rather than a boolean because the call
   * site needs the name; a flag would only make the caller map it back.
   */
  maxTokensParam: "max_tokens" | "max_completion_tokens";
}

export const MODELS: Record<ModelTier, ModelDefinition> = {
  /**
   * High-volume mechanical work: extract a verbatim quote, build one digest entry.
   *
   * An adverse-case run makes up to 224 extraction calls over a 56-document file. On the deep tier
   * that is roughly $21 per run; here it is under a dollar — for work whose output is gated against
   * the stored text anyway, so the verbatim check does not care which model produced it.
   */
  fast: {
    id: "gpt-5.6-luna",
    tier: "fast",
    purpose: "cost-sensitive, high-volume workloads",
    contextTokens: 1_050_000,
    inputCostPerMTok: 0.2,
    outputCostPerMTok: 1.2,
    supportsTemperature: false,
    supportsReasoningEffort: true,
    maxTokensParam: "max_completion_tokens"
  },
  /** Between the two. Nothing routes here by default; it exists so a caller can step down one notch. */
  balanced: {
    id: "gpt-5.6-terra",
    tier: "balanced",
    purpose: "balances intelligence and cost",
    contextTokens: 1_050_000,
    inputCostPerMTok: 2,
    outputCostPerMTok: 12,
    supportsTemperature: false,
    supportsReasoningEffort: true,
    maxTokensParam: "max_completion_tokens"
  },
  /**
   * Everything a lawyer reads, and everything that gates a citation: chat replies, the deep and
   * adverse assessments, document drafting, the entailment judge.
   */
  deep: {
    id: "gpt-5.6-sol",
    tier: "deep",
    purpose: "frontier model for complex professional work",
    contextTokens: 1_050_000,
    inputCostPerMTok: 5,
    outputCostPerMTok: 30,
    supportsTemperature: false,
    supportsReasoningEffort: true,
    maxTokensParam: "max_completion_tokens"
  }
};

/** The default for work a lawyer reads. */
export const DEFAULT_TIER: ModelTier = "deep";
/** The default for mechanical passes. */
export const BULK_TIER: ModelTier = "fast";

export function modelFor(tier: ModelTier): ModelDefinition {
  return MODELS[tier];
}

/**
 * What the user picks in the chat: how much deliberation this turn deserves.
 *
 * Two dials rather than one, because they trade off differently. Depth raises the reasoning effort
 * AND, at the top, the tier — a question about which piece mentions a date does not need what a
 * filed assessment needs, and paying for it on every turn is the failure mode this replaces.
 */
export type ReasoningDepth = "quick" | "standard" | "thorough";

export const DEPTHS: Record<
  ReasoningDepth,
  { tier: ModelTier; effort: ReasoningEffort }
> = {
  /** Look-ups and follow-ups. Cheapest and fastest thing that still reasons. */
  quick: { tier: "balanced", effort: "low" },
  /** The default for a normal question. */
  standard: { tier: "deep", effort: "medium" },
  /** Something that will be read closely, argued from, or filed. */
  thorough: { tier: "deep", effort: "high" }
};

export const DEFAULT_DEPTH: ReasoningDepth = "standard";

/**
 * Tokens to add to a caller's output budget to pay for the model's own thinking.
 *
 * `max_completion_tokens` is not the old `max_tokens` under a new name: it counts REASONING tokens
 * as well as prose. Measured against the live API — a hard prompt at effort `high` with a budget of
 * 4000 spent all 4000 reasoning and returned `content: ""` with `finish_reason: "length"`. Even the
 * cheap tier at effort `low` consumed a 300-token budget entirely on reasoning. So renaming the
 * parameter without this would have been the worse bug: instead of a loud 400, every hard input
 * would come back silently empty.
 *
 * A caller's `maxTokens` means "how much PROSE I want back", which is what it meant before the
 * rename. This preserves that meaning.
 *
 * The numbers are deliberately generous because the budget is a CEILING, not a reservation — an
 * unused allowance costs nothing, while a short one empties the response. Measured spend on this
 * app's real prompts (findings extraction over a source block, a running-summary fold) was 28-131
 * reasoning tokens; the allowance is roughly two orders of magnitude above that so the tail is
 * covered, and still low enough to bound a runaway: at the deep tier's $30/MTok, `high` caps one
 * call's worst case at about forty cents.
 */
export const REASONING_ALLOWANCE: Record<ReasoningEffort, number> = {
  low: 2_000,
  medium: 6_000,
  high: 12_000
};

/**
 * The value to send as the model's output ceiling, given how much prose the caller wants.
 *
 * Returns undefined when the caller set no budget — an absent ceiling is the API's default and is
 * not the same as an unlimited one.
 */
export function completionBudget(
  proseTokens: number | undefined,
  effort: ReasoningEffort
): number | undefined {
  if (proseTokens === undefined) return undefined;
  return proseTokens + REASONING_ALLOWANCE[effort];
}

/**
 * The request fields for a depth, ready to spread into a completion call.
 *
 * Capability-driven: a model that does not take reasoning_effort simply does not receive it, and
 * temperature is never sent to a model that rejects it. Adding an older model to the registry with
 * `supportsTemperature: true` is enough to make it work again — no call site changes.
 */
export function requestParamsFor(depth: ReasoningDepth): {
  model: string;
  reasoning_effort?: ReasoningEffort;
} {
  const { tier, effort } = DEPTHS[depth];
  const model = MODELS[tier];
  return {
    model: model.id,
    ...(model.supportsReasoningEffort ? { reasoning_effort: effort } : {})
  };
}
