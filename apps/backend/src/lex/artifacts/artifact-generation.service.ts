import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  LexArtifactBody,
  LexArtifactClaim,
  LexArtifactType,
  LexLanguage,
  LexVerificationStatus
} from "@packages/types";
import { z } from "zod";
import { OpenAiService } from "../../shared/openai.service";
import { RagService, type RetrievedChunk } from "../ai/rag.service";
import { languageName } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";
import { VerificationService, type ClaimDraft } from "./verification.service";

const EVIDENCE_PACK_SIZE = 12;
const MAX_PACK_CHUNK_CHARS = 2000;

export interface GeneratedArtifact {
  body: LexArtifactBody;
  verificationStatus: LexVerificationStatus;
  report: { total: number; supported: number; unsupported: number };
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
  }): Promise<GeneratedArtifact> {
    const query = `${params.title}\n${params.instructions ?? ""}`.trim();
    const pack = await this.rag.retrieve(
      params.ownerEmail,
      params.workspaceId,
      query,
      EVIDENCE_PACK_SIZE
    );

    const drafts = await this.draftClaims(
      params.type,
      params.title,
      params.instructions,
      pack,
      await this.settings.languageOf(params.ownerEmail)
    );

    const claims: LexArtifactClaim[] = [];
    for (const draft of drafts) {
      const verdict = await this.verification.verifyClaim(draft, pack);
      const claim: LexArtifactClaim = {
        claimId: randomUUID(),
        text: draft.text,
        status: verdict.status,
        citation:
          verdict.status === "supported" && verdict.source
            ? {
                chunkId: verdict.source.chunkId,
                documentId: verdict.source.documentId,
                filename: verdict.source.filename,
                pageFrom: verdict.source.pageFrom,
                pageTo: verdict.source.pageTo,
                quote: verdict.quote ?? ""
              }
            : null
      };
      claims.push(claim);
    }

    const supported = claims.filter((c) => c.status === "supported").length;
    const report = {
      total: claims.length,
      supported,
      unsupported: claims.length - supported
    };
    const verificationStatus: LexVerificationStatus =
      claims.length > 0 && supported === claims.length ? "verified" : "failed";

    this.logger.log(
      JSON.stringify({
        action: "lexArtifactGenerated",
        ...report,
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
      temperature: 0,
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
