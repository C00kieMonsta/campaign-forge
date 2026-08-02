import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  LexArtifact,
  LexArtifactBody,
  LexArtifactType,
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
  constructor(
    private pg: PgService,
    private workspaces: WorkspacesService,
    private generation: ArtifactGenerationService
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
   * must be re-verified before filing). Enforces the citation-drop invariant: a claim that
   * carried a citation in the current version may not silently disappear.
   */
  async saveVersion(
    ownerEmail: string,
    id: string,
    body: LexArtifactBody
  ): Promise<{ artifact: LexArtifact; version: LexArtifactVersion }> {
    const row = await this.getArtifactRow(ownerEmail, id);
    const current = await this.versionRow(row.id, row.current_version);

    const newClaimIds = new Set((body.claims ?? []).map((c) => c.claimId));
    const dropped = (current.body_json?.claims ?? [])
      .filter((c) => c.citation && !newClaimIds.has(c.claimId))
      .map((c) => c.claimId);
    if (dropped.length > 0) {
      throw new BadRequestException(
        `Refusing to drop cited claims: ${dropped.join(", ")}. Remove the citation explicitly instead.`
      );
    }

    const nextVersion = row.current_version + 1;
    const result = await this.pg.withTransaction(async (client) => {
      const verRes = await client.query<VersionRow>(
        `INSERT INTO lex_artifact_versions (artifact_id, version, body_json, verification_status)
         VALUES ($1, $2, $3, 'unverified') RETURNING *`,
        [row.id, nextVersion, JSON.stringify(body)]
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
