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
import { VerificationService, type ClaimDraft } from "./verification.service";

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
 * and must express the document as discrete claims, each citing exactly one pack source with
 * a verbatim supporting quote (or `sourceIndex: null` to flag an ungroundable statement — it
 * is never allowed to fabricate support). Every claim is then independently verified. The
 * version is only 'verified' if every claim is supported.
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

    // Every claim is judged against its OWN quote, so no verdict depends on another: the loop was
    // sequential for no reason, and on a 30-claim draft that is thirty frontier-model latencies end
    // to end. Bounded rather than unbounded only because of rate limits. Order is preserved, which
    // matters — the claims are the document's paragraphs, in argument order.
    let verified = 0;
    const verdicts = await mapWithConcurrency(
      drafts,
      VERIFY_CONCURRENCY,
      async (draft) => {
        const verdict = await this.verification.verifyClaim(draft, pack);
        verified += 1;
        await params.onProgress?.({
          phase: "verifying",
          done: verified,
          total: drafts.length,
          packSpans: pack.length,
          packDocuments: summariseSources(pack).length
        });
        return verdict;
      }
    );

    const claims: LexArtifactClaim[] = drafts.map((draft, i) => {
      const verdict = verdicts[i];
      return {
        claimId: randomUUID(),
        text: draft.text,
        status: verdict.status,
        reason: verdict.reason,
        citation:
          verdict.status === "supported" && verdict.source
            ? {
                chunkId: sourceKey(verdict.source),
                documentId: verdict.source.documentId,
                filename: verdict.source.filename,
                pageFrom: verdict.source.pageFrom,
                pageTo: verdict.source.pageTo,
                quote: verdict.quote ?? ""
              }
            : null
      };
    });

    const supported = claims.filter((c) => c.status === "supported").length;
    const report: LexArtifactVerificationReport = {
      total: claims.length,
      supported,
      unsupported: claims.length - supported,
      sources: summariseSources(pack),
      sourceMode: params.sourceMode ?? "search",
      truncated: pack.length >= packSize
    };
    const verificationStatus: LexVerificationStatus =
      claims.length > 0 && supported === claims.length ? "verified" : "failed";

    this.logger.log(
      JSON.stringify({
        action: "lexArtifactGenerated",
        total: report.total,
        supported: report.supported,
        unsupported: report.unsupported,
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
        "the provided SOURCES. Break the document into discrete factual CLAIMS in logical order. " +
        "Every claim that asserts a fact MUST cite exactly one source by number and include a " +
        "short quote copied EXACTLY (verbatim) from that source that supports it. If a necessary " +
        "statement cannot be grounded in the SOURCES, include it with sourceIndex null so it is " +
        "flagged — never fabricate a source or a quote. " +
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
        `Respond as JSON: {"claims":[{"text":"the claim sentence","sourceIndex":1,"quote":"verbatim excerpt from that source"}]}. ` +
        `Use sourceIndex null (and quote "") for any statement you cannot ground.`
    });

    try {
      const parsed = claimDraftResponseSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return [];
      return parsed.data.claims
        .filter((c) => c.text.trim().length > 0)
        .map((c) => ({
          text: c.text,
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
      sourceIndex: z.number().nullable().optional(),
      quote: z.string().optional()
    })
  )
});
