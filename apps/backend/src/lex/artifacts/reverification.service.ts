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
 * True when a claim is textually identical to how it stood in the previous version.
 *
 * All three fields, because each one changes what the verdict means: the SENTENCE is what is being
 * judged, the QUOTE is the evidence offered for it, and the ANCHOR is which span that quote is read
 * in. Two of the three matching is not the same claim.
 */
export function isUnchanged(
  claim: LexArtifactClaim,
  previous: LexArtifactClaim
): boolean {
  return (
    claim.text === previous.text &&
    (claim.citation?.quote ?? null) === (previous.citation?.quote ?? null) &&
    (claim.citation?.chunkId ?? null) === (previous.citation?.chunkId ?? null)
  );
}

/**
 * Whether a claim's previous verdict can stand instead of paying for a fresh judge call.
 *
 * Three conditions, and the third is the one that is easy to leave out: the claim must be identical,
 * it must have been SUPPORTED before (a previous rejection is re-judged, since the point of the
 * re-check is to give a corrected claim another hearing), and the quote must still be present in the
 * span AS IT STANDS TODAY. Gate 1 is free, and the passage can have changed underneath an untouched
 * claim — a re-ingested pièce, a rebuilt page index — which is precisely the case a carried-forward
 * verdict must not paper over.
 *
 * `span` absent means the anchor no longer resolves at all: nothing to carry forward.
 */
export function canCarryForward(
  claim: LexArtifactClaim,
  previous: LexArtifactClaim | undefined,
  span: RetrievedChunk | undefined
): boolean {
  if (!previous || previous.status !== "supported") return false;
  if (!claim.citation || !span) return false;
  if (!isUnchanged(claim, previous)) return false;
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
 *   CARRIED    the sentence, its quote and its anchor are byte-identical to a version where the
 *              claim was already `supported`, and gate 1 still passes against the span as it stands
 *              today → the previous verdict is reused. Gate 2 is deterministic in its inputs, so
 *              re-asking a frontier model the identical question to get the identical answer is
 *              pure cost. Gate 1 is re-run anyway because it is free and because the SPAN can have
 *              changed underneath an unchanged claim — a re-ingested pièce, a rebuilt page index —
 *              which is exactly the case a carried-forward verdict must not paper over.
 *   JUDGED     everything else: one judge call, as at generation.
 *
 * So fixing three sentences in a sixteen-claim draft costs three judge calls, not sixteen.
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
    /** The same claims as they stood in the previous version, for the carry-forward test. */
    previous?: readonly LexArtifactClaim[];
    onProgress?: (p: ReverifyProgress) => Promise<void>;
  }): Promise<ReverifyResult> {
    const { ownerEmail, workspaceId, claims } = params;
    const previousById = new Map(
      (params.previous ?? []).map((c) => [c.claimId, c])
    );

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
        !canCarryForward(c, previousById.get(c.claimId), spanOf(c))
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

        const previous = previousById.get(claim.claimId);
        const span = spanOf(claim);
        if (previous && canCarryForward(claim, previous, span)) {
          carriedForward += 1;
          return { ...claim, status: "supported", reason: previous.reason };
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
