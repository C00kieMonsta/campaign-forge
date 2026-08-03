import { Injectable } from "@nestjs/common";
import type {
  LexArtifactClaim,
  LexArtifactVerificationReport,
  LexClaimKind,
  LexVerificationStatus
} from "@packages/types";
import { z } from "zod";
import { OpenAiService } from "../../shared/openai.service";
import type { RetrievedChunk } from "../ai/rag.service";

export interface ClaimDraft {
  text: string;
  /** What the sentence IS, which decides whether it is verified at all. See LexClaimKind. */
  kind: LexClaimKind;
  sourceIndex: number | null; // 1-based into the frozen evidence pack
  quote: string;
}

export interface ClaimVerdict {
  status: "supported" | "unsupported" | "contradicted";
  reason: string;
  source?: RetrievedChunk;
  quote?: string;
}

/**
 * Whether verification simply does not apply to this sentence.
 *
 * TWO conditions, and the second is what keeps the first honest: a sentence is exempt only if it
 * declares itself something other than a factual assertion AND cites nothing at all. A claim that
 * came with a source is verified whatever it calls itself, so a drafter cannot relabel a shaky
 * factual sentence as `argument` to smuggle its citation past the judge — it would still be judged,
 * and the judge's question already separates a sentence's facts from its advocacy (JUDGE_SYSTEM).
 *
 * What remains, necessarily, is that an uncited sentence labelled `argument` is not checked. That
 * is not closable here — it is the same freedom the drafter has to omit the sentence entirely — so
 * it is handled by VISIBILITY instead: such claims are counted apart in the report and rendered
 * with their kind on the page and in the export, where the lawyer signing the document sees that
 * this sentence was filed as argument rather than as evidence.
 *
 * A missing kind means a draft from before kinds existed, where every sentence was judged as an
 * assertion. It must keep being judged as one, so `undefined` is never exempt.
 */
export function isExemptFromVerification(
  kind: LexClaimKind | undefined,
  citesASource: boolean
): boolean {
  return !citesASource && kind !== undefined && kind !== "assertion";
}

/**
 * The evidence counts for a body of claims: assertions only, with the exempt sentences apart.
 *
 * Shared by generation and re-verification so the two can never disagree about what "11/16" meant.
 */
export function tallyClaims(
  claims: readonly LexArtifactClaim[]
): Pick<
  LexArtifactVerificationReport,
  "total" | "supported" | "unsupported" | "notChecked" | "pending"
> {
  const count = (s: LexArtifactClaim["status"]) =>
    claims.filter((c) => c.status === s).length;
  const notChecked = count("not_checked");
  const pending = count("pending");
  const supported = count("supported");
  return {
    total: claims.length - notChecked,
    supported,
    // Judged and REFUSED. Pending claims are subtracted out: counting a sentence nobody has looked
    // at yet as one the judge rejected is how "you edited a paragraph" got reported as "you now have
    // sixteen unsupported claims".
    unsupported: claims.length - notChecked - supported - pending,
    notChecked,
    pending
  };
}

/**
 * A version is `verified` only when every verifiable claim is supported.
 *
 * Still all-or-nothing on the FACTS — one sentence the file does not establish keeps a document out
 * of a court filing, which is the whole point of the gate. What changed is the denominator: it is
 * the assertions, not every sentence in the document.
 *
 * A body with no assertions at all is NOT verified. A court document that establishes nothing is
 * either mis-labelled by the drafter or empty, and a green banner on it would be the most
 * misleading state this system could produce.
 *
 * `unverified` when anything is still awaiting a verdict, and that is a THIRD state on purpose: an
 * edited draft has not failed, it has not been looked at, and reporting it as `failed` sends the
 * drafter hunting for a rejection that does not exist. The distinction is also what lets a save that
 * only DELETED a bad claim come back `verified` without a single model call — every surviving claim
 * still holds the verdict it earned against its own quote.
 */
export function statusForClaims(
  claims: readonly LexArtifactClaim[]
): LexVerificationStatus {
  const { total, supported, pending } = tallyClaims(claims);
  if (pending) return "unverified";
  return total > 0 && supported === total ? "verified" : "failed";
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
 * How much of the source span the judge is shown around the quote.
 *
 * The span, not the document: enough to resolve a pronoun and see the sentence the quote sits in,
 * not enough to let the judge go hunting for support the quote does not carry. The prompt says so
 * explicitly, because a judge that treats the whole passage as evidence has quietly stopped
 * checking the citation and started checking the document.
 */
export const MAX_JUDGE_CONTEXT_CHARS = 2000;

/**
 * What the judge is actually asked.
 *
 * MEASURED, on three real runs over the 56-document case file. The previous prompt showed the judge
 * the quote ALONE and told it to default to false, and it rejected 11 of 19 claims — every one of
 * which carried a verbatim, correctly-indexed quote. Reading its reasons, it was mostly right about
 * the quote and wrong about the question: a court document's sentences are arguments built on facts,
 * and it was being asked whether the fact entailed the argument.
 *
 * Three failure shapes, all of them the question's fault rather than the drafter's:
 *
 *   ANAPHORA     "la citation ne précise pas que « qui » désigne Madame Monique Pirson" — the quote
 *                had been amputated from the sentence that named her.
 *   ATTRIBUTION  "n'indique pas qu'elle émane du notaire-liquidateur" — the attribution is WHICH
 *                DOCUMENT the quote is from, and the judge was not shown it.
 *   ADVOCACY     "n'indique pas que la défense le fera valoir" — true, and unfalsifiable: no 1996
 *                bank letter says what the defence will argue in 2026.
 *
 * So the judge now sees the passage and the document, and rules on the sentence's FACTUAL content.
 * Measured against the same rejected claims: 1/8 passed under the old prompt, 5/8 with the passage
 * and document, 6/8 with the factual-core rule. The two that still fail are genuine overreach —
 * including "ce crédit a financé les travaux", where the quote establishes only that the mortgage
 * was taken out. On a case that turns on the money trail, that is exactly the claim to stop.
 *
 * What this does NOT relax: a date, a party, an amount, a document or a further category that the
 * quote does not carry still fails, and so does a sentence that states the relation between facts
 * differently from its source.
 */
export const JUDGE_SYSTEM =
  "You are a strict legal fact-checker verifying one sentence of a court document.\n" +
  "A sentence may combine a FACTUAL ASSERTION about the case file with ARGUMENT — what a party " +
  "will contend, request, or submit, and how strongly. Your job is ONLY the factual assertion: " +
  "does the QUOTE, read in its SOURCE PASSAGE and attributed to its SOURCE DOCUMENT, establish " +
  "the facts the sentence asserts?\n" +
  "The passage and the document name are there to resolve pronouns, references and attribution in " +
  "the quote. They are NOT evidence for anything the quote itself does not say.\n" +
  "Answer true when every factual element is carried by the quote, even if the sentence also " +
  "argues from it, characterises it, or says what will be requested.\n" +
  "Answer false when the sentence asserts ANY fact the quote does not establish — a date, a party, " +
  "an amount, a document, or a further category — or when it states the relation between facts " +
  "differently from the quote. Default to false if there is any doubt.";

/**
 * Two-gate verification for a generated claim, in order of increasing cost:
 *  1. Deterministic verbatim backstop — the model's supporting quote must appear verbatim
 *     (whitespace-normalised, case-insensitive) inside the cited chunk's stored span. This
 *     catches hallucinated quotes and wrong-source citations without an LLM.
 *  2. Independent entailment judge — a separate LLM call confirms the quote establishes the FACTS
 *     the sentence asserts, reading it in its source passage and attributed to its source document
 *     (default-to-false; the reasoning models no longer accept a temperature, so the conservative
 *     default is what keeps the gate strict). See JUDGE_SYSTEM for what it is asked and why.
 * A claim is 'supported' only if BOTH gates pass.
 *
 * The two failures are deliberately different states, because the user can act on only one of them:
 * 'unsupported' means nothing usable was cited or the quote is not in the source — no evidence
 * behind the sentence. 'contradicted' means the quote is real and simply does not carry what the
 * sentence asserts, which is almost always one claim too many and is fixed by editing the sentence.
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
    return this.verifyAgainstSource(
      claim.text,
      claim.quote,
      pack[claim.sourceIndex - 1]
    );
  }

  /**
   * Both gates against a source span already resolved by the caller.
   *
   * Separated from verifyClaim so re-verification runs the SAME two gates: it starts from a stored
   * citation's anchor rather than from an index into a freshly-retrieved pack, and a second copy of
   * the gates is how the filing rule and the re-check rule drift apart.
   */
  async verifyAgainstSource(
    text: string,
    quote: string,
    source: RetrievedChunk
  ): Promise<ClaimVerdict> {
    // Gate 1: verbatim backstop against the exact chunk span.
    if (!quoteMatchesChunk(quote, source.content)) {
      return {
        status: "unsupported",
        reason: "Supporting quote not found verbatim in the cited source",
        source
      };
    }

    // Gate 2: independent entailment judge.
    const raw = await this.openai.complete({
      json: true,
      system: JUDGE_SYSTEM,
      user:
        `SENTENCE: ${text}\n\nQUOTE: ${quote}\n\n` +
        `SOURCE DOCUMENT: ${source.filename}\n` +
        `SOURCE PASSAGE:\n${source.content.slice(0, MAX_JUDGE_CONTEXT_CHARS)}\n\n` +
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
    return { status: "supported", reason, source, quote };
  }
}
