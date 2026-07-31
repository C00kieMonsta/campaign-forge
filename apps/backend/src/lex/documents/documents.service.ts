import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type {
  LexDocument,
  LexLifecycleState,
  LexParseStatus,
  LexTranscript,
  LexUploadSlot,
  PresignUploadRequest
} from "@packages/types";
import { LexS3Service } from "../../shared/lex-s3.service";
import { PgService } from "../../shared/pg.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { isAudio } from "./document-parser";

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentRow {
  id: string;
  workspace_id: string;
  owner_email: string;
  filename: string;
  content_type: string | null;
  size_bytes: string | null;
  s3_key: string;
  s3_version_id: string | null;
  sha256: string;
  parse_status: LexParseStatus;
  lifecycle_state: LexLifecycleState;
  timeline_date: Date | string | null;
  page_count: number | null;
  summary: string | null;
  language: string | null;
  key_names: unknown;
  tags: unknown;
  duration_seconds: number | null;
  duplicate_of: string | null;
  source_path: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Every column mapDocument needs — `transcript` is deliberately excluded: it is a sub-resource
 * (see getTranscript) that can run to tens of thousands of characters, so no document read,
 * list or timeline should carry it.
 */
const DOC_COLUMNS = `id, workspace_id, owner_email, filename, content_type, size_bytes, s3_key,
  s3_version_id, sha256, parse_status, lifecycle_state, timeline_date, page_count, summary,
  language, key_names, tags, duration_seconds, duplicate_of, source_path, error, metadata,
  created_at, updated_at`;

interface TranscriptRow {
  id: string;
  transcript: string | null;
  duration_seconds: number | null;
  parse_status: LexParseStatus;
  updated_at: Date;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function dateOnly(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date
    ? v.toISOString().slice(0, 10)
    : String(v).slice(0, 10);
}

export function mapDocument(r: DocumentRow): LexDocument {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerEmail: r.owner_email,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    s3Key: r.s3_key,
    s3VersionId: r.s3_version_id,
    sha256: r.sha256,
    parseStatus: r.parse_status,
    lifecycleState: r.lifecycle_state,
    timelineDate: dateOnly(r.timeline_date),
    pageCount: r.page_count,
    summary: r.summary,
    language: r.language,
    keyNames: asStringArray(r.key_names),
    tags: asStringArray(r.tags),
    durationSeconds: r.duration_seconds,
    duplicateOf: r.duplicate_of,
    sourcePath: r.source_path,
    error: r.error,
    metadata: r.metadata ?? {},
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private pg: PgService,
    private s3: LexS3Service,
    private workspaces: WorkspacesService
  ) {}

  /**
   * Step 1 of upload: reserve a document row per file and hand back a presigned PUT URL.
   *
   * The row is created before its bytes exist (parse_status 'awaiting_upload'), so sha256 is
   * NOT computed here — the ingestion worker derives it from the object it already downloads.
   * That is what lets the bytes go browser → S3 directly, instead of through nginx and the box.
   */
  async presignUploads(
    ownerEmail: string,
    workspaceId: string,
    files: PresignUploadRequest["files"]
  ): Promise<{ uploads: LexUploadSlot[] }> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId); // ownership + existence

    const uploads: LexUploadSlot[] = [];
    for (const file of files) {
      const id = randomUUID();
      const ext = (file.filename.split(".").pop() || "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 10);
      const key = `lex/${ownerEmail}/${workspaceId}/${id}/original.${ext || "bin"}`;
      const contentType = file.contentType || "application/octet-stream";

      const res = await this.pg.query<DocumentRow>(
        `INSERT INTO lex_documents
           (id, workspace_id, owner_email, filename, content_type, size_bytes, s3_key,
            source_path, parse_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'awaiting_upload')
         RETURNING ${DOC_COLUMNS}`,
        [
          id,
          workspaceId,
          ownerEmail,
          file.filename,
          contentType,
          file.size,
          key,
          file.sourcePath ?? null
        ]
      );

      uploads.push({
        document: mapDocument(res.rows[0]),
        // Signed for the exact Content-Type the browser must send, or S3 rejects the signature.
        uploadUrl: await this.s3.presignedPutUrl(key, contentType),
        contentType
      });
    }

    return { uploads };
  }

  /**
   * Step 2 of upload: confirm the bytes landed, then queue ingestion.
   *
   * Every object is HEADed rather than trusted: a browser PUT can fail or be abandoned, and
   * queueing a job for an object that is not there would just produce a failed document. Rows
   * whose object is missing are left 'awaiting_upload' for the sweeper to reap.
   */
  async completeUploads(
    ownerEmail: string,
    documentIds: string[]
  ): Promise<{ documents: LexDocument[]; missing: string[] }> {
    const documents: LexDocument[] = [];
    const missing: string[] = [];

    for (const id of documentIds) {
      const found = await this.pg.query<{
        s3_key: string;
        workspace_id: string;
      }>(
        `SELECT s3_key, workspace_id FROM lex_documents
         WHERE id = $1 AND owner_email = $2 AND parse_status = 'awaiting_upload'`,
        [id, ownerEmail]
      );
      if (found.rows.length === 0) {
        missing.push(id);
        continue;
      }

      const head = await this.s3.head(found.rows[0].s3_key);
      if (!head) {
        missing.push(id);
        continue;
      }

      const doc = await this.pg.withTransaction(async (client) => {
        const res = await client.query<DocumentRow>(
          `UPDATE lex_documents
             SET parse_status = 'uploaded', size_bytes = $2, s3_version_id = $3,
                 updated_at = now()
           WHERE id = $1
           RETURNING ${DOC_COLUMNS}`,
          [id, head.size, head.versionId ?? null]
        );
        await client.query(
          `INSERT INTO lex_ingestion_jobs (document_id, workspace_id) VALUES ($1, $2)`,
          [id, found.rows[0].workspace_id]
        );
        return res.rows[0];
      });
      documents.push(mapDocument(doc));
    }

    this.logger.log(
      JSON.stringify({
        action: "lexCompleteUploads",
        completed: documents.length,
        missing: missing.length
      })
    );
    return { documents, missing };
  }

  /** Short-lived presigned URL to view/download (or, for a voice note, listen to) a document. */
  async viewUrl(
    ownerEmail: string,
    id: string
  ): Promise<{ url: string; expiresIn: number }> {
    const doc = await this.getOrFail(ownerEmail, id);
    const url = await this.s3.presignedGetUrl(
      doc.s3Key,
      doc.s3VersionId ?? undefined
    );
    return { url, expiresIn: 900 };
  }

  async list(
    ownerEmail: string,
    workspaceId: string,
    status?: string
  ): Promise<LexDocument[]> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const params: unknown[] = [workspaceId, ownerEmail];
    let where = `workspace_id = $1 AND owner_email = $2`;
    if (status) {
      params.push(status);
      where += ` AND parse_status = $3`;
    }
    const res = await this.pg.query<DocumentRow>(
      `SELECT ${DOC_COLUMNS} FROM lex_documents WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    return res.rows.map(mapDocument);
  }

  async timeline(
    ownerEmail: string,
    workspaceId: string
  ): Promise<LexDocument[]> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const res = await this.pg.query<DocumentRow>(
      `SELECT ${DOC_COLUMNS} FROM lex_documents
       WHERE workspace_id = $1 AND owner_email = $2
       ORDER BY timeline_date ASC NULLS LAST, created_at ASC`,
      [workspaceId, ownerEmail]
    );
    return res.rows.map(mapDocument);
  }

  async getOrFail(ownerEmail: string, id: string): Promise<LexDocument> {
    const res = await this.pg.query<DocumentRow>(
      `SELECT ${DOC_COLUMNS} FROM lex_documents WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Document not found");
    return mapDocument(res.rows[0]);
  }

  /** The voice note's transcript — fetched on demand so document reads stay light. */
  async getTranscript(ownerEmail: string, id: string): Promise<LexTranscript> {
    const res = await this.pg.query<TranscriptRow>(
      `SELECT id, transcript, duration_seconds, parse_status, updated_at
       FROM lex_documents WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0)
      throw new NotFoundException("Document not found");
    const r = res.rows[0];
    return {
      documentId: r.id,
      transcript: r.transcript,
      durationSeconds: r.duration_seconds,
      parseStatus: r.parse_status,
      updatedAt: iso(r.updated_at)
    };
  }

  /**
   * Saves a hand-corrected transcript and re-indexes the document from it (mode 'reindex' —
   * no second transcription spend). The corrected text becomes what retrieval and citations see.
   */
  async updateTranscript(
    ownerEmail: string,
    id: string,
    transcript: string
  ): Promise<LexTranscript> {
    const doc = await this.getOrFail(ownerEmail, id);
    // Audio only: a document's indexed text must stay faithful to its source, and only a voice
    // note's text is transcribed (and therefore correctable). Allowing this on a PDF would let
    // citations quote text that appears nowhere in the filed document.
    if (!isAudio(doc.contentType ?? "", doc.filename))
      throw new BadRequestException("Document is not a voice note");
    const text = transcript.trim();
    if (text.length === 0)
      throw new BadRequestException("Transcript cannot be empty");

    await this.pg.withTransaction(async (client) => {
      await client.query(
        `UPDATE lex_documents
           SET transcript = $2, parse_status = 'uploaded', error = NULL, updated_at = now()
         WHERE id = $1`,
        [id, text]
      );
      await client.query(
        `INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)
         VALUES ($1, $2, 'reindex')`,
        [id, doc.workspaceId]
      );
    });

    return this.getTranscript(ownerEmail, id);
  }

  /**
   * Queues a metadata-only refresh of every already-indexed document the user owns. Used after
   * the pinned language changes, so existing summaries stop being a mix of languages. Cheap
   * relative to a re-ingest: no S3 fetch, no OCR, no transcription, no re-embedding.
   */
  async resummarizeAll(ownerEmail: string): Promise<{ queued: number }> {
    const res = await this.pg.query<{ id: string }>(
      `INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)
       SELECT d.id, d.workspace_id, 'resummarize'
       FROM lex_documents d
       WHERE d.owner_email = $1
         AND d.parse_status = 'ready'
         -- Skip documents that already have a job waiting, so repeated clicks don't pile up.
         AND NOT EXISTS (
           SELECT 1 FROM lex_ingestion_jobs j
           WHERE j.document_id = d.id AND j.status IN ('queued', 'running')
         )
       RETURNING id`,
      [ownerEmail]
    );
    this.logger.log(
      JSON.stringify({
        action: "lexResummarizeAll",
        ownerEmail,
        queued: res.rows.length
      })
    );
    return { queued: res.rows.length };
  }

  /** Re-runs speech-to-text on the stored audio, discarding the current transcript. */
  async retranscribe(ownerEmail: string, id: string): Promise<LexDocument> {
    const doc = await this.getOrFail(ownerEmail, id);
    if (!isAudio(doc.contentType ?? "", doc.filename))
      throw new BadRequestException("Document is not a voice note");

    await this.pg.withTransaction(async (client) => {
      await client.query(
        `UPDATE lex_documents
           SET parse_status = 'uploaded', error = NULL, updated_at = now()
         WHERE id = $1`,
        [id]
      );
      await client.query(
        `INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)
         VALUES ($1, $2, 'full')`,
        [id, doc.workspaceId]
      );
    });

    return this.getOrFail(ownerEmail, id);
  }

  async statusOf(
    ownerEmail: string,
    id: string
  ): Promise<{
    id: string;
    parseStatus: LexParseStatus;
    error: string | null;
  }> {
    const doc = await this.getOrFail(ownerEmail, id);
    return {
      id: doc.id,
      parseStatus: doc.parseStatus,
      error: doc.error ?? null
    };
  }

  /**
   * Re-queues a document for ingestion from its stored bytes. Used for the failures that are not
   * the document's fault — a transient OCR outage, or a crash mid-batch — so the user can retry
   * without re-uploading a 40 MB scan.
   */
  async retry(ownerEmail: string, id: string): Promise<LexDocument> {
    const doc = await this.getOrFail(ownerEmail, id);
    if (doc.parseStatus === "awaiting_upload")
      throw new BadRequestException(
        "This document was never uploaded; discard it instead"
      );

    await this.pg.withTransaction(async (client) => {
      await client.query(
        `UPDATE lex_documents
           SET parse_status = 'uploaded', lifecycle_state = 'active',
               duplicate_of = NULL, error = NULL, updated_at = now()
         WHERE id = $1`,
        [id]
      );
      await client.query(
        `INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)
         VALUES ($1, $2, 'full')`,
        [id, doc.workspaceId]
      );
    });
    return this.getOrFail(ownerEmail, id);
  }

  /** Deletes several documents at once (multi-select in the documents view). */
  async deleteMany(
    ownerEmail: string,
    ids: string[]
  ): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.delete(ownerEmail, id);
        deleted++;
      } catch (err) {
        // One bad id must not abort the rest of the selection.
        this.logger.warn(
          JSON.stringify({
            action: "lexBulkDeleteSkip",
            id,
            error: String(err)
          })
        );
      }
    }
    this.logger.log(
      JSON.stringify({
        action: "lexBulkDelete",
        requested: ids.length,
        deleted
      })
    );
    return { deleted };
  }

  /**
   * Discards every document in a workspace with one of the given statuses.
   *
   * The motivating case is `awaiting_upload`: a presign reserves a row before the browser PUTs
   * the bytes, so a tab closed or a server restarted mid-batch leaves rows that will never have
   * an object behind them. They are not recoverable — there is nothing to retry — so the honest
   * options are discard or leave clutter. `failed` is offered on the same endpoint so a bundle of
   * unparseable files can be cleared in one action.
   */
  async discardByStatus(
    ownerEmail: string,
    workspaceId: string,
    statuses: LexParseStatus[]
  ): Promise<{ deleted: number }> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM lex_documents
       WHERE workspace_id = $1 AND owner_email = $2 AND parse_status = ANY($3::text[])`,
      [workspaceId, ownerEmail, statuses]
    );
    return this.deleteMany(
      ownerEmail,
      res.rows.map((r) => r.id)
    );
  }

  async delete(ownerEmail: string, id: string): Promise<void> {
    const doc = await this.getOrFail(ownerEmail, id);
    try {
      await this.s3.delete(doc.s3Key);
    } catch (err) {
      // Best-effort: keep going so a missing S3 object never blocks row deletion.
      this.logger.warn(
        JSON.stringify({ action: "lexDocDeleteS3", id, error: String(err) })
      );
    }
    await this.pg.query(
      `DELETE FROM lex_documents WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
  }
}
