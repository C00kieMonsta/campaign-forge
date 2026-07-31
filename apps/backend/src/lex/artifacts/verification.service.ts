import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { OpenAiService } from "../../shared/openai.service";
import type { RetrievedChunk } from "../ai/rag.service";

export interface ClaimDraft {
  text: string;
  sourceIndex: number | null; // 1-based into the frozen evidence pack
  quote: string;
}

export interface ClaimVerdict {
  status: "supported" | "unsupported" | "contradicted";
  reason: string;
  source?: RetrievedChunk;
  quote?: string;
}

const judgmentSchema = z.object({
  supported: z.boolean(),
  reason: z.string().optional()
});

/** Whitespace-normalised, case-insensitive comparison key. */
export function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The deterministic verbatim backstop: the quote must appear inside the chunk span. */
export function quoteMatchesChunk(quote: string, content: string): boolean {
  if (!quote) return false;
  return normalizeForMatch(content).includes(normalizeForMatch(quote));
}

/**
 * Two-gate verification for a generated claim, in order of increasing cost:
 *  1. Deterministic verbatim backstop — the model's supporting quote must appear verbatim
 *     (whitespace-normalised, case-insensitive) inside the cited chunk's stored span. This
 *     catches hallucinated quotes and wrong-source citations without an LLM.
 *  2. Independent entailment judge — a separate LLM call confirms the quote actually
 *     supports the claim (temperature 0, default-to-false).
 * A claim is 'supported' only if BOTH gates pass.
 */
@Injectable()
export class VerificationService {
  constructor(private openai: OpenAiService) {}

  async verifyClaim(
    claim: ClaimDraft,
    pack: RetrievedChunk[]
  ): Promise<ClaimVerdict> {
    if (
      claim.sourceIndex === null ||
      claim.sourceIndex < 1 ||
      claim.sourceIndex > pack.length
    ) {
      return { status: "unsupported", reason: "No valid source cited" };
    }
    const source = pack[claim.sourceIndex - 1];

    // Gate 1: verbatim backstop against the exact chunk span.
    if (!quoteMatchesChunk(claim.quote, source.content)) {
      return {
        status: "unsupported",
        reason: "Supporting quote not found verbatim in the cited source",
        source
      };
    }

    // Gate 2: independent entailment judge.
    const raw = await this.openai.complete({
      json: true,
      temperature: 0,
      system:
        "You are a strict legal fact-checker. Decide ONLY whether the QUOTE, on its own, " +
        "directly supports the CLAIM. Default to false if there is any doubt.",
      user:
        `CLAIM: ${claim.text}\n\nQUOTE: ${claim.quote}\n\n` +
        `Respond as JSON: {"supported": true|false, "reason": "one short sentence"}`
    });

    // Fail-closed: any parse/validation failure leaves the claim unsupported.
    let supported = false;
    let reason = "judge returned no verdict";
    try {
      const parsed = judgmentSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        supported = parsed.data.supported;
        reason = parsed.data.reason ?? reason;
      } else {
        reason = "judge response failed validation";
      }
    } catch {
      reason = "judge response was not parseable";
    }

    if (!supported) return { status: "contradicted", reason, source };
    return { status: "supported", reason, source, quote: claim.quote };
  }
}
