import { Injectable } from "@nestjs/common";
import type { LexArtifactClaim } from "@packages/types";
import { RagService, type RetrievedChunk } from "../ai/rag.service";
import { mapWithConcurrency } from "./artifact-generation.service";
import {
  isExemptFromVerification,
  quoteMatchesChunk,
  VerificationService
} from "./verification.service";

/**
 * Judge calls in flight at once. Same reason and same number as generation's: eight keeps a
 * forty-claim re-check under a minute without walking into the account's rate limit.
 */
const VERIFY_CONCURRENCY = 8;

/** Where a re-check has got to, for the task trace. */
export interface ReverifyProgress {
  done: number;
  total: number;
}

export interface ReverifyResult {
  claims: LexArtifactClaim[];
  /** Claims that needed a judge call. The rest were exempt or carried forward. */
  judged: number;
  /** Claims whose verdict was reused from the previous version because nothing changed. */
  carriedForward: number;
  /**
   * The spans the verdicts were read from, keyed by anchor.
   *
   * Returned rather than discarded because the caller re-files lex_citations from these verdicts,
   * and the row's char offsets and content hash come from the span that was actually read. Without
   * them a re-verified citation would be filed with NULL anchors — a citation that cannot detect
   * the passage under it changing, which is the one thing that column exists for.
   */
  spans: Map<string, RetrievedChunk>;
}

/**
 * True when a claim is materially identical to how it stood in the stored version.
 *
 * FOUR fields, because each one changes what a verdict about this claim would mean: the SENTENCE is
 * what is being judged, the QUOTE is the evidence offered for it, the ANCHOR is which span that
 * quote is read in, and the KIND decides whether it is judged at all. Three of the four matching is
 * not the same claim.
 */
export function isUnchanged(
  claim: LexArtifactClaim,
  previous: LexArtifactClaim
): boolean {
  return (
    claim.text === previous.text &&
    (claim.kind ?? "assertion") === (previous.kind ?? "assertion") &&
    (claim.citation?.quote ?? null) === (previous.citation?.quote ?? null) &&
    (claim.citation?.chunkId ?? null) === (previous.citation?.chunkId ?? null)
  );
}

/**
 * The verdicts a saved body may keep, claim by claim.
 *
 * THE granularity fix. A verdict is established for one claim against one quote, independently of
 * every other claim in the document — so editing one paragraph invalidates exactly that paragraph.
 * Holding the staleness at the version level instead (which is what this replaced) meant a single
 * reworded sentence blanked fifteen standing citations and sent the whole document back through the
 * judge, at fifteen frontier-model calls for no new information.
 *
 * The verdict fields come from the STORED claim, never from the submission: an unchanged claim keeps
 * what the server itself last wrote, and a changed one is forced to `pending`. That is what makes a
 * citation chip believable — a client cannot mark its own edit `supported`, because its `status` is
 * discarded either way. A claim with no counterpart in the stored body is new, so it is `pending`.
 *
 * `reason` is cleared on a pending claim: it explained a verdict that no longer applies, and leaving
 * "la citation n'établit pas ce qui est affirmé" under a sentence the drafter has just rewritten to
 * fix precisely that is worse than saying nothing.
 */
export function reconcileClaims(
  submitted: readonly LexArtifactClaim[],
  stored: readonly LexArtifactClaim[]
): LexArtifactClaim[] {
  const storedById = new Map(stored.map((c) => [c.claimId, c]));
  return submitted.map((claim) => {
    const previous = storedById.get(claim.claimId);
    if (previous && isUnchanged(claim, previous)) return previous;
    return { ...claim, status: "pending", reason: null };
  });
}

/**
 * Whether a claim's standing verdict can be kept instead of paying for a fresh judge call.
 *
 * No diff here, deliberately: by the time re-verification runs, a claim's stored status ALREADY
 * corresponds to its stored text and quote — reconcileClaims guarantees it at save time, and a claim
 * that was edited is sitting at `pending`. So the question is only whether the verdict was positive
 * and whether it still holds against the source as it stands today.
 *
 * Gate 1 re-runs even on this fast path because it is free, and because the SPAN can change
 * underneath an untouched claim — a re-ingested pièce, a rebuilt page index. That is exactly the case
 * a kept verdict must not paper over. `span` absent means the anchor no longer resolves at all.
 */
export function canKeepVerdict(
  claim: LexArtifactClaim,
  span: RetrievedChunk | undefined
): boolean {
  if (claim.status !== "supported") return false;
  if (!claim.citation || !span) return false;
  return quoteMatchesChunk(claim.citation.quote, span.content);
}

/**
 * Re-checks a saved artifact body against the file, so an edited draft can reach `verified` again.
 *
 * The gates are VerificationService's, unchanged and in the same order — this service only decides
 * WHICH claims need to run through them, which is the difference between a re-check and a second
 * verification implementation that drifts from the first.
 *
 * Three ways a claim gets its verdict here, cheapest first:
 *
 *   EXEMPT     asserts no fact and cites nothing → `not_checked`, no work. Same rule as generation.
 *   KEPT       the claim already stands `supported` and gate 1 still passes against the span as it
 *              is today → the verdict is kept. Gate 2 is deterministic in its inputs, so re-asking a
 *              frontier model the identical question to get the identical answer is pure cost.
 *   JUDGED     everything else — every `pending` claim, and every claim a judge previously refused,
 *              which is the point: a corrected sentence gets a fresh hearing.
 *
 * It reads the STORED body and nothing else. No comparison against an earlier version is needed,
 * because reconcileClaims already did that work at save time: a claim's stored status corresponds to
 * its stored text, and anything edited is sitting at `pending`. So fixing three sentences in a
 * sixteen-claim draft costs three judge calls, not sixteen.
 */
@Injectable()
export class ReverificationService {
  constructor(
    private rag: RagService,
    private verification: VerificationService
  ) {}

  async reverify(params: {
    ownerEmail: string;
    workspaceId: string;
    claims: readonly LexArtifactClaim[];
    onProgress?: (p: ReverifyProgress) => Promise<void>;
  }): Promise<ReverifyResult> {
    const { ownerEmail, workspaceId, claims } = params;

    // Every anchor in one round trip, before any judging: the spans are what both gates read, and
    // fetching them per claim would be one query per claim for no benefit.
    const spans = await this.rag.loadSpans(
      ownerEmail,
      workspaceId,
      claims.map((c) => c.citation?.chunkId).filter((k): k is string => !!k)
    );

    const spanOf = (c: LexArtifactClaim) =>
      c.citation ? spans.get(c.citation.chunkId) : undefined;

    const needsJudge = claims.filter(
      (c) =>
        !isExemptFromVerification(c.kind, Boolean(c.citation)) &&
        !canKeepVerdict(c, spanOf(c))
    ).length;

    let judged = 0;
    let carriedForward = 0;
    const out = await mapWithConcurrency(
      claims,
      VERIFY_CONCURRENCY,
      async (claim): Promise<LexArtifactClaim> => {
        if (isExemptFromVerification(claim.kind, Boolean(claim.citation))) {
          return {
            ...claim,
            status: "not_checked",
            reason: null,
            citation: null
          };
        }

        const span = spanOf(claim);
        if (canKeepVerdict(claim, span)) {
          carriedForward += 1;
          return claim;
        }

        // An assertion with no citation left — the drafter removed it, or never had one. Nothing to
        // read, so no judge call: the same verdict verifyClaim gives an out-of-range source index.
        if (!claim.citation || !span) {
          judged += 1;
          await params.onProgress?.({ done: judged, total: needsJudge });
          return {
            ...claim,
            status: "unsupported",
            // Two different absences, and the lawyer can act on only one of them: her own edit
            // removed the citation, or the pièce behind it is no longer in the file.
            reason: claim.citation
              ? "The cited passage is no longer in the case file"
              : "No valid source cited",
            citation: null
          };
        }

        const verdict = await this.verification.verifyAgainstSource(
          claim.text,
          claim.citation.quote,
          span
        );
        judged += 1;
        await params.onProgress?.({ done: judged, total: needsJudge });
        return {
          ...claim,
          status: verdict.status,
          reason: verdict.reason,
          // The anchor is REWRITTEN from the span that was actually read, not kept from the stored
          // citation: a manual edit may have left a filename or page number that no longer matches
          // the passage, and a footnote naming the wrong page is worse than none.
          //
          // Kept on a CONTRADICTED verdict as well, for the same reason generation keeps it: that
          // claim is fixed by editing the sentence down to what the quote establishes, and the
          // drafter cannot do that without the quote in front of her. 'unsupported' keeps nothing —
          // there the quote is not in the source, so it is not a citation at all.
          citation:
            verdict.status === "supported" || verdict.status === "contradicted"
              ? {
                  chunkId: claim.citation.chunkId,
                  documentId: span.documentId,
                  filename: span.filename,
                  pageFrom: span.pageFrom,
                  pageTo: span.pageTo,
                  quote: claim.citation.quote
                }
              : null
        };
      }
    );

    return { claims: out, judged, carriedForward, spans };
  }
}
