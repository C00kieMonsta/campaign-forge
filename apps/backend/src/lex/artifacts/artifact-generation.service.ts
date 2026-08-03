import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ARTIFACT_PACK_SIZE } from "@packages/types";
import type {
  LexArtifactBody,
  LexArtifactClaim,
  LexArtifactSource,
  LexArtifactType,
  LexArtifactVerificationReport,
  LexLanguage,
  LexVerificationStatus
} from "@packages/types";
import { z } from "zod";
import { OpenAiService } from "../../shared/openai.service";
import { RagService, sourceKey, type RetrievedChunk } from "../ai/rag.service";
import { languageName } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";
import {
  isExemptFromVerification,
  statusForClaims,
  tallyClaims,
  VerificationService,
  type ClaimDraft,
  type ClaimVerdict
} from "./verification.service";

const MAX_PACK_CHUNK_CHARS = 2000;

/**
 * Which pièces the evidence pack came from, most-drawn-upon first.
 *
 * Ordering matters more than it looks: this list is what the user reads to decide whether the draft
 * rests on the right pièces, and a pièce contributing eleven spans is a different fact about the
 * draft than one contributing a single passage. Ties fall back to the filename so two runs over the
 * same pack render identically.
 */
export function summariseSources(
  pack: readonly RetrievedChunk[]
): LexArtifactSource[] {
  const byDocument = new Map<string, LexArtifactSource>();
  for (const c of pack) {
    const existing = byDocument.get(c.documentId);
    if (existing) existing.passages += 1;
    else
      byDocument.set(c.documentId, {
        documentId: c.documentId,
        filename: c.filename,
        passages: 1
      });
  }
  return [...byDocument.values()].sort(
    (a, b) => b.passages - a.passages || a.filename.localeCompare(b.filename)
  );
}

/**
 * Judge calls in flight at once.
 *
 * Eight rather than unlimited: the judge runs on the frontier tier and a 40-claim draft firing 40
 * simultaneous completions is how an account meets its rate limit mid-document. Eight turns a
 * six-minute serial verification into well under a minute while staying far inside the limit.
 */
const VERIFY_CONCURRENCY = 8;

/** Where a run has got to, for the task trace. */
export interface GenerationProgress {
  phase: "retrieving" | "drafting" | "verifying";
  done: number;
  total: number;
  packSpans: number;
  packDocuments: number;
}

/**
 * Maps with at most `limit` promises in flight, preserving input order in the output.
 *
 * Order matters here: the claims are the document's paragraphs and must come back in argument
 * order, not completion order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

export interface GeneratedArtifact {
  body: LexArtifactBody;
  verificationStatus: LexVerificationStatus;
  report: LexArtifactVerificationReport;
  pack: RetrievedChunk[];
}

/**
 * Grounded artifact generation. The model receives a FROZEN evidence pack (retrieved once)
 * and must express the document as discrete claims, each labelled with what it IS and — if it
 * asserts a fact — citing exactly one pack source with a verbatim supporting quote (or
 * `sourceIndex: null` to flag an ungroundable assertion; it is never allowed to fabricate
 * support). Every factual assertion is then independently verified, and the version is
 * 'verified' only if all of them are supported. A sentence that asserts no fact and cites
 * nothing — a request to the court, a heading — is recorded as `not_checked` and counted apart:
 * see LexClaimKind and isExemptFromVerification.
 */
@Injectable()
export class ArtifactGenerationService {
  private readonly logger = new Logger(ArtifactGenerationService.name);

  constructor(
    private openai: OpenAiService,
    private rag: RagService,
    private verification: VerificationService,
    private settings: SettingsService
  ) {}

  async generate(params: {
    ownerEmail: string;
    workspaceId: string;
    type: LexArtifactType;
    title: string;
    instructions?: string;
    /** Which pièces the drafter may use; undefined means the whole case file. */
    documentIds?: string[];
    /** `full` widens the pack to everything in the selection instead of a similarity sample. */
    sourceMode?: "search" | "full";
    /**
     * Called as the run advances, so a background task can show what it is doing.
     *
     * Awaited rather than fired: the caller persists progress, and a run that outpaced its own
     * progress writes would show a stale step for minutes at a time.
     */
    onProgress?: (p: GenerationProgress) => Promise<void>;
  }): Promise<GeneratedArtifact> {
    const query = `${params.title}\n${params.instructions ?? ""}`.trim();
    // `search` samples by similarity; `full` widens the pack sixteenfold over the same selection.
    // Both are caps, and `full` is bounded on purpose: the reading tier holds a million tokens, but
    // a pack of every chunk in a 54-document file is 12 765 spans and the drafter would spend its
    // attention on the wrong ones. The report records whether the cap was reached, so a draft never
    // quietly rests on a sample the user believes was her whole selection.
    const packSize = ARTIFACT_PACK_SIZE[params.sourceMode ?? "search"];
    const pack = await this.rag.retrieve(
      params.ownerEmail,
      params.workspaceId,
      query,
      packSize,
      params.documentIds
    );

    await params.onProgress?.({
      phase: "drafting",
      done: 0,
      total: 0,
      packSpans: pack.length,
      packDocuments: summariseSources(pack).length
    });

    const drafts = await this.draftClaims(
      params.type,
      params.title,
      params.instructions,
      pack,
      await this.settings.languageOf(params.ownerEmail)
    );

    // Only the FACTUAL claims are judged. A prayer for relief and a section heading assert nothing
    // the case file could establish, and sending them to the judge was not merely wasted money: the
    // verdict came back 'unsupported' and one such sentence took the whole document out of the
    // filing path with nothing the drafter could do about it. See isExemptFromVerification for why
    // the exemption is refused to any claim that cites a source.
    const verifiable = drafts.filter(
      (d) => !isExemptFromVerification(d.kind, d.sourceIndex !== null)
    ).length;

    // Every claim is judged against its OWN quote, so no verdict depends on another: the loop was
    // sequential for no reason, and on a 30-claim draft that is thirty frontier-model latencies end
    // to end. Bounded rather than unbounded only because of rate limits. Order is preserved, which
    // matters — the claims are the document's paragraphs, in argument order.
    let verified = 0;
    const verdicts = await mapWithConcurrency(
      drafts,
      VERIFY_CONCURRENCY,
      async (draft): Promise<ClaimVerdict | null> => {
        if (isExemptFromVerification(draft.kind, draft.sourceIndex !== null)) {
          return null;
        }
        const verdict = await this.verification.verifyClaim(draft, pack);
        verified += 1;
        await params.onProgress?.({
          phase: "verifying",
          done: verified,
          total: verifiable,
          packSpans: pack.length,
          packDocuments: summariseSources(pack).length
        });
        return verdict;
      }
    );

    const claims: LexArtifactClaim[] = drafts.map((draft, i) => {
      const verdict = verdicts[i];
      // No verdict means verification did not apply. `reason` stays null rather than explaining
      // itself: the kind already says why, and a sentence carrying "not applicable" as its reason
      // reads on the page as a sentence with a problem.
      if (!verdict) {
        return {
          claimId: randomUUID(),
          text: draft.text,
          kind: draft.kind,
          status: "not_checked",
          reason: null,
          citation: null
        };
      }
      return {
        claimId: randomUUID(),
        text: draft.text,
        kind: draft.kind,
        status: verdict.status,
        reason: verdict.reason,
        // Kept on a CONTRADICTED claim too, not only a supported one.
        //
        // 'contradicted' means the quote is real and simply does not carry what the sentence
        // asserts, and it is fixed by editing the sentence down to what the quote does establish —
        // which is impossible without seeing the quote. Dropping it left the drafter a reason and no
        // evidence. It does not leak into a filing: the export and lex_citations both key off
        // `status === "supported"`, and the UI branches on the status before the citation.
        //
        // 'unsupported' keeps nothing on purpose: either nothing was cited, or the quote was not in
        // the source at all, and rendering a quote that is not in the file as though it were a
        // citation is the one thing this pipeline exists to prevent.
        citation:
          (verdict.status === "supported" ||
            verdict.status === "contradicted") &&
          verdict.source
            ? {
                chunkId: sourceKey(verdict.source),
                documentId: verdict.source.documentId,
                filename: verdict.source.filename,
                pageFrom: verdict.source.pageFrom,
                pageTo: verdict.source.pageTo,
                quote: verdict.quote ?? draft.quote
              }
            : null
      };
    });

    const report: LexArtifactVerificationReport = {
      ...tallyClaims(claims),
      sources: summariseSources(pack),
      sourceMode: params.sourceMode ?? "search",
      truncated: pack.length >= packSize
    };
    const verificationStatus: LexVerificationStatus = statusForClaims(claims);

    this.logger.log(
      JSON.stringify({
        action: "lexArtifactGenerated",
        total: report.total,
        supported: report.supported,
        unsupported: report.unsupported,
        notChecked: report.notChecked,
        packSpans: pack.length,
        packDocuments: report.sources?.length ?? 0,
        sourceMode: report.sourceMode,
        verificationStatus
      })
    );

    return {
      body: { type: "lex-artifact", claims },
      verificationStatus,
      report,
      pack
    };
  }

  private async draftClaims(
    type: LexArtifactType,
    title: string,
    instructions: string | undefined,
    pack: RetrievedChunk[],
    language: LexLanguage
  ): Promise<ClaimDraft[]> {
    if (pack.length === 0) return [];

    const sourcesBlock = pack
      .map(
        (s, i) =>
          `[${i + 1}] (${s.filename}${s.pageFrom ? `, p.${s.pageFrom}` : ""}):\n` +
          s.content.slice(0, MAX_PACK_CHUNK_CHARS)
      )
      .join("\n\n");

    const raw = await this.openai.complete({
      json: true,
      maxTokens: 3000,
      system:
        "You are a Belgian-law legal drafter. You draft court documents grounded strictly in " +
        "the provided SOURCES. Break the document into discrete CLAIMS in logical order.\n" +
        // The label decides whether the sentence is checked against the file, so the rule is
        // stated as a test on the sentence rather than as four definitions: anything a pièce could
        // confirm or refute is an assertion, and the drafter does not get to opt out of that by
        // calling it something else.
        "Label every claim with a KIND:\n" +
        "  assertion — states a fact about the case file: an event, a date, a party, an amount, " +
        "a document's content. If a pièce could confirm or refute the sentence, it is an " +
        "assertion, even when it also argues from the fact.\n" +
        "  argument — what a party contends or infers, asserting no new fact of its own.\n" +
        "  relief — what the court is asked to order, or a procedural request.\n" +
        "  heading — a title, a section label or a transition.\n" +
        "Every `assertion` MUST cite exactly one source by number and include a short quote copied " +
        "EXACTLY (verbatim) from that source that supports it. If an assertion cannot be grounded " +
        "in the SOURCES, include it with sourceIndex null so it is flagged — never fabricate a " +
        "source or a quote, and never relabel an ungrounded fact as `argument` to avoid citing it.\n" +
        "The other kinds normally cite nothing (sourceIndex null). Cite a source on one only if a " +
        "quote genuinely supports it; it will then be checked exactly like an assertion. " +
        // Deliberately field-scoped, NOT the shared outputLanguageInstruction: `quote` is
        // matched character-for-character against the source chunk by VerificationService, so a
        // translated quote fails verification and the whole draft comes back unverified.
        `Write every "text" field in ${languageName(language)}, whatever language the sources ` +
        `are in. Every "quote" field must stay EXACTLY as it appears in the source — never ` +
        `translate, correct or reformat a quote.`,
      user:
        `Document type: ${type}\nTitle: ${title}\n` +
        `${instructions ? `Instructions: ${instructions}\n` : ""}\n` +
        `SOURCES:\n${sourcesBlock}\n\n` +
        `Respond as JSON: {"claims":[{"text":"the claim sentence","kind":"assertion","sourceIndex":1,"quote":"verbatim excerpt from that source"}]}. ` +
        `Use sourceIndex null (and quote "") for any statement you cannot ground.`
    });

    try {
      const parsed = claimDraftResponseSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return [];
      return parsed.data.claims
        .filter((c) => c.text.trim().length > 0)
        .map((c) => ({
          text: c.text,
          // An omitted or unrecognised kind falls back to `assertion`, the only value that gets
          // the sentence CHECKED. Defaulting the other way would mean a model that skipped the
          // field silently exempted the whole document from verification.
          kind: c.kind ?? "assertion",
          sourceIndex: c.sourceIndex ?? null,
          quote: c.quote ?? ""
        }));
    } catch {
      return [];
    }
  }
}

// The model's drafted claims, validated before verification. Loose on optional/nullable
// fields (the model omits them) but strict that `text` is a string.
const claimDraftResponseSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      // `catch` rather than a bare optional: a model that answers "factual" or "fact" would fail
      // the enum and take the entire draft to zero claims through the safeParse below. An
      // unreadable label is a labelling failure, and the safe reading of one is "check it".
      kind: z
        .enum(["assertion", "argument", "relief", "heading"])
        .catch("assertion")
        .optional(),
      sourceIndex: z.number().nullable().optional(),
      quote: z.string().optional()
    })
  )
});
