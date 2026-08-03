import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type {
  LexArtifact,
  LexArtifactBody,
  LexArtifactType,
  LexArtifactVerificationReport,
  LexArtifactVersion,
  LexVerificationStatus
} from "@packages/types";
import type { PoolClient } from "pg";
import { PgService } from "../../shared/pg.service";
import { sourceKey, type RetrievedChunk } from "../ai/rag.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import {
  ArtifactGenerationService,
  type GeneratedArtifact,
  type GenerationProgress
} from "./artifact-generation.service";
import {
  ReverificationService,
  type ReverifyProgress
} from "./reverification.service";
import { statusForClaims, tallyClaims } from "./verification.service";

interface ArtifactRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  owner_email: string;
  type: LexArtifactType;
  title: string;
  status: LexArtifact["status"];
  current_version: number;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  artifact_id: string;
  version: number;
  body_json: LexArtifactBody;
  verification_status: LexVerificationStatus;
  verification_report: LexArtifactVersion["verificationReport"] | null;
  signed_off_at: Date | null;
  signed_off_by: string | null;
  created_at: Date;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapArtifact(r: ArtifactRow): LexArtifact {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    conversationId: r.conversation_id,
    ownerEmail: r.owner_email,
    type: r.type,
    title: r.title,
    status: r.status,
    currentVersion: r.current_version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

function mapVersion(r: VersionRow): LexArtifactVersion {
  return {
    id: r.id,
    artifactId: r.artifact_id,
    version: r.version,
    bodyJson: r.body_json,
    verificationStatus: r.verification_status,
    verificationReport: r.verification_report ?? null,
    signedOffAt: r.signed_off_at ? iso(r.signed_off_at) : null,
    signedOffBy: r.signed_off_by,
    createdAt: iso(r.created_at)
  };
}

@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(
    private pg: PgService,
    private workspaces: WorkspacesService,
    private generation: ArtifactGenerationService,
    private reverification: ReverificationService
  ) {}

  async list(ownerEmail: string, workspaceId: string): Promise<LexArtifact[]> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const res = await this.pg.query<ArtifactRow>(
      `SELECT * FROM lex_artifacts WHERE workspace_id = $1 AND owner_email = $2
       ORDER BY updated_at DESC`,
      [workspaceId, ownerEmail]
    );
    return res.rows.map(mapArtifact);
  }

  async getArtifactRow(ownerEmail: string, id: string): Promise<ArtifactRow> {
    const res = await this.pg.query<ArtifactRow>(
      `SELECT * FROM lex_artifacts WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Artifact not found");
    return res.rows[0];
  }

  private async versionRow(
    artifactId: string,
    version: number
  ): Promise<VersionRow> {
    const res = await this.pg.query<VersionRow>(
      `SELECT * FROM lex_artifact_versions WHERE artifact_id = $1 AND version = $2`,
      [artifactId, version]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Artifact version not found");
    return res.rows[0];
  }

  async getWithVersion(
    ownerEmail: string,
    id: string
  ): Promise<{ artifact: LexArtifact; version: LexArtifactVersion }> {
    const row = await this.getArtifactRow(ownerEmail, id);
    const version = await this.versionRow(row.id, row.current_version);
    return { artifact: mapArtifact(row), version: mapVersion(version) };
  }

  async generate(
    ownerEmail: string,
    params: {
      workspaceId: string;
      conversationId?: string;
      type: LexArtifactType;
      title: string;
      instructions?: string;
      documentIds?: string[];
      sourceMode?: "search" | "full";
      onProgress?: (p: GenerationProgress) => Promise<void>;
    }
  ): Promise<{ artifact: LexArtifact; version: LexArtifactVersion }> {
    await this.workspaces.getOrFail(ownerEmail, params.workspaceId);

    const generated: GeneratedArtifact = await this.generation.generate({
      ownerEmail,
      workspaceId: params.workspaceId,
      type: params.type,
      title: params.title,
      instructions: params.instructions,
      documentIds: params.documentIds,
      sourceMode: params.sourceMode,
      onProgress: params.onProgress
    });

    const packByChunk = new Map<string, RetrievedChunk>();
    for (const c of generated.pack) packByChunk.set(sourceKey(c), c);

    const artifactStatus: LexArtifact["status"] =
      generated.verificationStatus === "verified" ? "verified" : "draft";

    const result = await this.pg.withTransaction(async (client) => {
      const artRes = await client.query<ArtifactRow>(
        `INSERT INTO lex_artifacts
           (workspace_id, conversation_id, owner_email, type, title, status, current_version)
         VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING *`,
        [
          params.workspaceId,
          params.conversationId ?? null,
          ownerEmail,
          params.type,
          params.title,
          artifactStatus
        ]
      );
      const artifact = artRes.rows[0];

      const verRes = await client.query<VersionRow>(
        `INSERT INTO lex_artifact_versions
           (artifact_id, version, body_json, verification_status, verification_report)
         VALUES ($1, 1, $2, $3, $4) RETURNING *`,
        [
          artifact.id,
          JSON.stringify(generated.body),
          generated.verificationStatus,
          JSON.stringify(generated.report)
        ]
      );
      const version = verRes.rows[0];

      await this.insertCitations(
        client,
        ownerEmail,
        version.id,
        generated.body,
        packByChunk
      );
      return { artifact, version };
    });

    return {
      artifact: mapArtifact(result.artifact),
      version: mapVersion(result.version)
    };
  }

  /** Human sign-off: only a machine-verified version can be signed off (and then exported). */
  async signOff(
    ownerEmail: string,
    id: string
  ): Promise<{ artifact: LexArtifact; version: LexArtifactVersion }> {
    const row = await this.getArtifactRow(ownerEmail, id);
    const current = await this.versionRow(row.id, row.current_version);
    if (current.verification_status !== "verified") {
      throw new ConflictException(
        "Only a machine-verified version can be signed off"
      );
    }
    await this.pg.withTransaction(async (client) => {
      await client.query(
        `UPDATE lex_artifact_versions SET signed_off_at = now(), signed_off_by = $2 WHERE id = $1`,
        [current.id, ownerEmail]
      );
      await client.query(
        `UPDATE lex_artifacts SET status = 'final', updated_at = now() WHERE id = $1`,
        [row.id]
      );
    });
    return this.getWithVersion(ownerEmail, id);
  }

  /**
   * Saves an edited body as a NEW version and re-sets verification to 'unverified' (edits
   * must be re-verified before filing — see reverify, which is how a corrected draft gets back to
   * 'verified'; without it this method was a one-way door out of the filing path). Enforces the
   * citation-drop invariant: a claim that carried a citation in the current version may not
   * disappear unless the caller says so explicitly.
   */
  async saveVersion(
    ownerEmail: string,
    id: string,
    body: LexArtifactBody,
    /** Cited claims the caller is deleting deliberately. See saveArtifactRequestSchema. */
    dropCitedClaimIds: readonly string[] = []
  ): Promise<{ artifact: LexArtifact; version: LexArtifactVersion }> {
    const row = await this.getArtifactRow(ownerEmail, id);
    const current = await this.versionRow(row.id, row.current_version);

    const newClaimIds = new Set((body.claims ?? []).map((c) => c.claimId));
    const acknowledged = new Set(dropCitedClaimIds);
    const dropped = (current.body_json?.claims ?? [])
      .filter(
        (c) =>
          c.citation &&
          !newClaimIds.has(c.claimId) &&
          !acknowledged.has(c.claimId)
      )
      .map((c) => c.claimId);
    if (dropped.length > 0) {
      throw new BadRequestException(
        `Refusing to drop cited claims: ${dropped.join(", ")}. List them in dropCitedClaimIds to delete them deliberately.`
      );
    }

    const nextVersion = row.current_version + 1;
    const result = await this.pg.withTransaction(async (client) => {
      const verRes = await client.query<VersionRow>(
        `INSERT INTO lex_artifact_versions
           (artifact_id, version, body_json, verification_status, verification_report)
         VALUES ($1, $2, $3, 'unverified', $4) RETURNING *`,
        [
          row.id,
          nextVersion,
          JSON.stringify(body),
          // The PROVENANCE carries forward, the verdict does not. Which pièces the draft was
          // written from is still true after the lawyer rewrites a sentence — and dropping it (as
          // this used to) made the "Pièces lues" panel vanish the moment anyone edited anything,
          // taking with it the only way to see a selected pièce that contributed nothing. The
          // counts are recomputed but must not be read as a verdict: the version is 'unverified',
          // and the UI says so instead of showing them.
          JSON.stringify({
            ...tallyClaims(body.claims ?? []),
            sources: current.verification_report?.sources,
            sourceMode: current.verification_report?.sourceMode,
            truncated: current.verification_report?.truncated
          })
        ]
      );
      const version = verRes.rows[0];
      // Carry citations forward from the edited body (offsets/hash unknown on manual edits).
      await this.insertCitations(
        client,
        ownerEmail,
        version.id,
        body,
        new Map()
      );
      const artRes = await client.query<ArtifactRow>(
        `UPDATE lex_artifacts SET current_version = $2, status = 'draft', updated_at = now()
         WHERE id = $1 RETURNING *`,
        [row.id, nextVersion]
      );
      return { artifact: artRes.rows[0], version };
    });
    return {
      artifact: mapArtifact(result.artifact),
      version: mapVersion(result.version)
    };
  }

  /**
   * Re-checks the current version against the case file and rewrites its verdicts IN PLACE.
   *
   * The closing edge of the edit loop. saveVersion resets a version to 'unverified' and sign-off
   * requires 'verified', so without this a lawyer who corrected an unsupported claim had produced a
   * document that could never be filed — the state machine had no path back.
   *
   * In place rather than as a new version, deliberately: re-verification changes no text. A version
   * is a state of the DOCUMENT, and minting one per re-check would fill the history with entries
   * that differ only in what a judge said about identical words.
   *
   * Refuses a signed-off version. The signature attests to a body against a verdict, and this could
   * replace that verdict — silently leaving a document marked as signed by a human who never saw
   * the new one. Editing mints a fresh version, which is the honest way to revisit a signed draft.
   */
  async reverify(
    ownerEmail: string,
    id: string,
    onProgress?: (p: ReverifyProgress) => Promise<void>
  ): Promise<{
    artifact: LexArtifact;
    version: LexArtifactVersion;
    judged: number;
    carriedForward: number;
  }> {
    const row = await this.getArtifactRow(ownerEmail, id);
    const current = await this.versionRow(row.id, row.current_version);
    if (current.signed_off_at) {
      throw new ConflictException(
        "A signed-off version cannot be re-verified. Edit it to create a new version first."
      );
    }

    const claims = current.body_json?.claims ?? [];
    if (claims.length === 0) {
      throw new BadRequestException("This version has no claims to verify");
    }

    // The version this one was edited from, for the carry-forward test: an untouched claim keeps
    // its verdict instead of paying a frontier-model judge to reach the same conclusion again.
    const previous =
      row.current_version > 1
        ? await this.versionRow(row.id, row.current_version - 1).catch(
            () => null
          )
        : null;

    const result = await this.reverification.reverify({
      ownerEmail,
      workspaceId: row.workspace_id,
      claims,
      previous: previous?.body_json?.claims,
      onProgress
    });

    const body: LexArtifactBody = {
      type: "lex-artifact",
      claims: result.claims
    };
    const status = statusForClaims(result.claims);
    const report: LexArtifactVerificationReport = {
      ...tallyClaims(result.claims),
      // Provenance survives a re-check untouched — it records what the DRAFTER read, which no
      // verdict can change.
      sources: current.verification_report?.sources,
      sourceMode: current.verification_report?.sourceMode,
      truncated: current.verification_report?.truncated
    };

    await this.pg.withTransaction(async (client) => {
      await client.query(
        `UPDATE lex_artifact_versions
           SET body_json = $2, verification_status = $3, verification_report = $4
         WHERE id = $1`,
        [current.id, JSON.stringify(body), status, JSON.stringify(report)]
      );
      // Re-filed, not merged: a claim that lost its support must lose its citation row too, and
      // the rows carry the anchors of the spans this run actually read.
      await client.query(
        `DELETE FROM lex_citations WHERE artifact_version_id = $1`,
        [current.id]
      );
      await this.insertCitations(
        client,
        ownerEmail,
        current.id,
        body,
        result.spans
      );
      await client.query(
        `UPDATE lex_artifacts SET status = $2, updated_at = now() WHERE id = $1`,
        [row.id, status === "verified" ? "verified" : "draft"]
      );
    });

    this.logger.log(
      JSON.stringify({
        action: "lexArtifactReverified",
        artifactId: row.id,
        version: current.version,
        total: report.total,
        supported: report.supported,
        unsupported: report.unsupported,
        notChecked: report.notChecked,
        judged: result.judged,
        carriedForward: result.carriedForward,
        verificationStatus: status
      })
    );

    const { artifact, version } = await this.getWithVersion(ownerEmail, id);
    return {
      artifact,
      version,
      judged: result.judged,
      carriedForward: result.carriedForward
    };
  }

  async delete(ownerEmail: string, id: string): Promise<void> {
    const res = await this.pg.query(
      `DELETE FROM lex_artifacts WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rowCount === 0) throw new NotFoundException("Artifact not found");
  }

  private async insertCitations(
    client: PoolClient,
    ownerEmail: string,
    artifactVersionId: string,
    body: LexArtifactBody,
    packByChunk: Map<string, RetrievedChunk>
  ): Promise<void> {
    for (const claim of body.claims ?? []) {
      if (claim.status !== "supported" || !claim.citation) continue;
      const source = packByChunk.get(claim.citation.chunkId);
      const contentHash = source
        ? createHash("sha256").update(source.content).digest("hex")
        : null;
      // The anchors come from the RESOLVED source, never from claim.citation.chunkId — that field
      // is an opaque table-prefixed identity (see lexCitationEventSchema), not a uuid, and it is
      // also whatever was persisted in the artifact body, which may name a span this pack no
      // longer contains. An unresolvable claim is filed with NULL anchors and keeps its quote:
      // a citation that admits it is unanchored beats one pointing at a row that is not there.
      await client.query(
        `INSERT INTO lex_citations
           (owner_email, artifact_version_id, claim_id, chunk_id, page_id, page_ordinal,
            page_text_hash, document_id, quote, page_from, page_to, char_start, char_end,
            chunk_content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          ownerEmail,
          artifactVersionId,
          claim.claimId,
          source?.chunkId ?? null,
          source?.pageId ?? null,
          source?.pageOrdinal ?? null,
          source?.pageTextHash ?? null,
          claim.citation.documentId,
          claim.citation.quote,
          claim.citation.pageFrom,
          claim.citation.pageTo,
          source?.charStart ?? null,
          source?.charEnd ?? null,
          contentHash
        ]
      );
    }
  }
}
