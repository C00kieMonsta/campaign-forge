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
  LexPageIndexBackfill,
  LexPageIndexBlockedDocument,
  LexPageIndexStatus,
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

/**
 * Blocked documents are named so the user knows which files to re-ingest, but the list is capped:
 * this endpoint is polled while a backfill runs, and a bundle where every scan needs OCR would
 * otherwise return the whole workspace on every poll.
 */
const PAGE_INDEX_BLOCKED_SAMPLE = 50;
/** Enough of the worker's message to name the cause; page_index_error has no length limit. */
const PAGE_INDEX_ERROR_CHARS = 400;

interface PageIndexCountsRow {
  total: number;
  indexed: number;
  pending: number;
  queued: number;
  blocked: number;
}

interface BlockedPageIndexRow {
  id: string;
  filename: string;
  page_index_error: string;
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

  /**
   * Queues the per-page index backfill (mode 'pages') for the documents indexed before that index
   * existed. Those documents have no page rows, so pinning page 6 falls back to the chunk path and
   * hands the model a 4000-char window spanning pp. 4-8 — a quote from p. 8 then gets filed as
   * "p. 4". The job re-derives the text from the stored S3 object and re-uses the existing chunks,
   * embeddings and summary: no re-embedding, no OCR, no transcription, no paid call.
   *
   * The scope is narrow on purpose — a document qualifies only when it is retrievable AND has no
   * index:
   *   parse_status = 'ready'       anything else (needs_ocr, failed, still uploading) has no chunks,
   *                               and the job's safety check is precisely "do the re-derived page
   *                               offsets still slice back to every stored chunk". With nothing to
   *                               verify against there is nothing to keep consistent, so such a
   *                               document can only fail — the fix is a full re-ingest, not this.
   *   lifecycle_state = 'active'   excludes the superseded duplicates. markIfDuplicate deletes a
   *                               duplicate's chunks AND its page rows so it is not page-routable;
   *                               writing page rows back would re-arm exactly what that removed and
   *                               let one fact be cited from two copies of the same annex.
   *   page_index_version = 0       an indexed document is left alone. A rebuild costs an S3 GET and
   *                               a parse for no gain, and it DELETEs page rows that live citations
   *                               may be anchored to (page_id is ON DELETE SET NULL).
   *
   * Note the version column alone is not proof that page rows exist — a document indexed and then
   * re-ingested as a duplicate keeps page_index_version = 1 with zero rows — but such a document is
   * 'duplicate'/'superseded' and so is already outside this scope twice over.
   *
   * A document that previously failed the backfill (page_index_error set, version still 0) DOES
   * come back through here: the retry is free, and what blocked it can have been fixed outside
   * SQL's view. pageIndexStatus is what tells the user which files stay stuck.
   */
  async buildPageIndexAll(ownerEmail: string): Promise<LexPageIndexBackfill> {
    const res = await this.pg.query<{ id: string }>(
      `INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)
       SELECT d.id, d.workspace_id, 'pages'
       FROM lex_documents d
       WHERE d.owner_email = $1
         AND d.parse_status = 'ready'
         AND d.lifecycle_state = 'active'
         AND d.page_index_version = 0
         -- Any mode, not only 'pages': a queued 'full' or 'reindex' writes the page rows itself, so
         -- a 'pages' job behind it is wasted work — and one racing it would build the index against
         -- text the other job is still replacing.
         AND NOT EXISTS (
           SELECT 1 FROM lex_ingestion_jobs j
           WHERE j.document_id = d.id AND j.status IN ('queued', 'running')
         )
       RETURNING id`,
      [ownerEmail]
    );
    this.logger.log(
      JSON.stringify({
        action: "lexBuildPageIndexAll",
        ownerEmail,
        queued: res.rows.length
      })
    );
    return { queued: res.rows.length };
  }

  /**
   * Progress readout for the backfill: a bulk job over a whole case file is unusable without one,
   * and the blocked list is the only place the user learns WHICH files need a paid re-ingest
   * (page_index_error is written by the worker and surfaced nowhere else).
   *
   * Counted over the same population the backfill targets — ready + active — so the three states
   * are disjoint and sum to `total`; a document outside that scope is not "pending", it is simply
   * not part of this migration.
   */
  async pageIndexStatus(ownerEmail: string): Promise<LexPageIndexStatus> {
    const counts = await this.pg.query<PageIndexCountsRow>(
      // ::int on every count because an unqualified count() is int8, which node-postgres hands
      // back as a string — these are read straight into a numeric wire type.
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE d.page_index_version > 0)::int AS indexed,
              count(*) FILTER (
                WHERE d.page_index_version = 0 AND d.page_index_error IS NULL
              )::int AS pending,
              -- Blocked means "no index, and we know why". The version = 0 conjunct is what keeps
              -- the buckets disjoint: the worker clears the error when it succeeds, so the two are
              -- mutually exclusive today, but an error left behind next to a built index is stale
              -- and the built index is what retrieval actually uses.
              count(*) FILTER (
                WHERE d.page_index_version = 0 AND d.page_index_error IS NOT NULL
              )::int AS blocked,
              -- Not a fourth bucket: un-indexed documents (pending, or a blocked one being
              -- retried) with work in flight. The only signal that distinguishes "the worker is
              -- chewing through the queue" from "the worker is down and nothing will ever move".
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM lex_ingestion_jobs j
                  WHERE j.document_id = d.id AND j.mode = 'pages'
                    AND j.status IN ('queued', 'running')
                )
              )::int AS queued
       FROM lex_documents d
       WHERE d.owner_email = $1
         AND d.parse_status = 'ready' AND d.lifecycle_state = 'active'`,
      [ownerEmail]
    );
    // An aggregate with no GROUP BY always returns exactly one row.
    const row = counts.rows[0];

    // Second read only when there is something to name — the healthy case (and every poll after a
    // clean backfill) stays a single query.
    const blockedDocuments: LexPageIndexBlockedDocument[] = [];
    if (row.blocked > 0) {
      const res = await this.pg.query<BlockedPageIndexRow>(
        // Alphabetical rather than newest-first: the user reconciles this list against the folder
        // they uploaded, and the cap means the order decides what they get to see.
        `SELECT d.id, d.filename, left(d.page_index_error, $2) AS page_index_error
         FROM lex_documents d
         WHERE d.owner_email = $1
           AND d.parse_status = 'ready' AND d.lifecycle_state = 'active'
           AND d.page_index_version = 0 AND d.page_index_error IS NOT NULL
         ORDER BY d.filename ASC
         LIMIT $3`,
        [ownerEmail, PAGE_INDEX_ERROR_CHARS, PAGE_INDEX_BLOCKED_SAMPLE]
      );
      for (const r of res.rows)
        blockedDocuments.push({
          documentId: r.id,
          filename: r.filename,
          error: r.page_index_error
        });
    }

    return {
      total: row.total,
      indexed: row.indexed,
      pending: row.pending,
      queued: row.queued,
      blocked: row.blocked,
      blockedDocuments,
      blockedTruncated: row.blocked > blockedDocuments.length
    };
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
