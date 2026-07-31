import { createHash } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type { LexLanguage, LexParseStatus } from "@packages/types";
import { z } from "zod";
import { ConfigService } from "../../config/config.service";
import { LexS3Service } from "../../shared/lex-s3.service";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { languageName } from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";
import {
  buildFullText,
  chunkText,
  normalizeForFingerprint,
  sanitizeForStorage,
  stitchChunks
} from "./chunker";
import { parseDocument } from "./document-parser";
import { MistralOcrService } from "./mistral-ocr.service";
import {
  assertPageRoundTrip,
  buildPageRows,
  firstSpanMismatch,
  pageTextHash
} from "./pager";

const POLL_INTERVAL_MS = 5000;
const EMBED_BATCH = 64;
const SUMMARY_INPUT_CHARS = 12000;
// Concurrent in-process workers draining the job queue (each claims its own job via
// FOR UPDATE SKIP LOCKED). Kept small so ingestion never starves the Campaigns API on the
// shared box; OCR/transcription are offloaded to APIs so these workers mostly orchestrate.
const POOL_SIZE = 3;

/**
 * How long a claimed job may sit with no progress before another worker may take it back.
 *
 * A job is claimed by flipping it to 'running', so a deploy or an OOM kill mid-flight strands up to
 * POOL_SIZE jobs in that state with no worker behind them. Nothing noticed before: the enqueue
 * guards skip documents with a job 'queued' or 'running', so a stranded job silently excluded its
 * document from every later enqueue — a bulk backfill would report a count quietly short by three
 * and those documents would never be indexed, with nothing anywhere saying why.
 *
 * Generous, because the longest legitimate step is OCR of a large scan, and reclaiming a job that
 * is genuinely still running would duplicate that spend. LexTasks uses the same pattern.
 */
const STALE_CLAIM_SECONDS = 30 * 60;
/** After this many claims a job is failed rather than reclaimed, so a poison job cannot loop. */
const MAX_JOB_ATTEMPTS = 3;

/**
 * full        — derive the text from the S3 source (parse / OCR / transcribe), then index.
 * reindex     — reuse the stored transcript (hand-corrected by the user), then index. Skips the
 *               transcription spend, which is the whole point of storing the transcript.
 * resummarize — redo ONLY step 4 (summary/date/language/names/tags) from the already-stored
 *               chunks. Chunks and embeddings are left untouched, and neither OCR nor
 *               transcription is paid for again. Used to bring existing documents into line
 *               after the owner changes their pinned language.
 * pages       — build ONLY the per-page index of a document that is already indexed. Costs
 *               nothing at all: the text comes from the stored transcript or the S3 text layer,
 *               and no step of it embeds, summarizes, OCRs or transcribes. Backfills the
 *               documents ingested before the page index existed, which sit at
 *               page_index_version = 0 and therefore still answer a pinned page through the
 *               coarse chunk grain.
 */
type JobMode = "full" | "reindex" | "resummarize" | "pages";

interface JobRow {
  id: string;
  document_id: string;
  mode: JobMode;
}

interface DocRow {
  id: string;
  workspace_id: string;
  owner_email: string;
  filename: string;
  content_type: string | null;
  s3_key: string;
  transcript: string | null;
}

/** The document text, ready to chunk (one entry per page / sheet / transcript). */
interface TextSource {
  pages: string[];
  pageCount: number;
  /** What `pages` is, so the page index labels rows honestly rather than inventing page numbers. */
  pageKind: "page" | "sheet" | "blob";
  sheetNames?: string[];
}

/**
 * In-process document ingestion worker. Polls lex_ingestion_jobs, claims jobs with
 * SELECT ... FOR UPDATE SKIP LOCKED, and runs text-acquisition → chunk → embed → summarize on
 * the single EC2. Text acquisition is the text layer, or Mistral OCR (scans/images), or Whisper
 * (voice notes) — all offloaded to APIs, so POOL_SIZE workers mostly wait on I/O and never
 * fight the Campaigns API for CPU. Designed to be swapped for an SQS consumer later without
 * touching the pipeline. Inert unless Lex is configured (DATABASE_URL present), so
 * Campaigns-only deploys never start it.
 */
@Injectable()
export class IngestionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private pg: PgService,
    private openai: OpenAiService,
    private s3: LexS3Service,
    private ocr: MistralOcrService,
    private settings: SettingsService,
    private config: ConfigService
  ) {}

  onModuleInit(): void {
    if (!this.config.get("DATABASE_URL")) {
      this.logger.log(
        "Lex ingestion worker idle (DATABASE_URL not configured)"
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Before claiming anything, take back jobs abandoned by a previous process — otherwise their
      // documents are permanently invisible to the enqueue guards. Best-effort by design: a failure
      // here must not stop the queue draining.
      await this.reclaimStaleJobs().catch((err) =>
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "lexIngestReclaimFailed",
            error: String(err)
          })
        )
      );
      // Run POOL_SIZE workers concurrently; each drains until the queue is empty. Distinct
      // jobs are guaranteed by the FOR UPDATE SKIP LOCKED claim.
      await Promise.all(
        Array.from({ length: POOL_SIZE }, () => this.drainLoop())
      );
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "lexIngestTick",
          error: String(err)
        })
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Requeues jobs left 'running' by a process that died, or fails them once they have burned
   * through MAX_JOB_ATTEMPTS.
   *
   * A failed job also marks its document, but ONLY for the modes that leave it genuinely unusable.
   * A 'pages' or 'resummarize' job that dies has changed nothing a reader can see — the document is
   * still indexed and still answers questions — so flipping it to parse_status 'failed' would
   * report a working document as broken because a maintenance pass was interrupted.
   */
  private async reclaimStaleJobs(): Promise<void> {
    const res = await this.pg.query<{
      id: string;
      document_id: string;
      mode: JobMode;
      status: string;
      attempts: number;
    }>(
      `UPDATE lex_ingestion_jobs
         SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
             last_error = CASE WHEN attempts >= $2
                               THEN 'Interrupted repeatedly without completing.'
                               ELSE last_error END,
             locked_at = NULL,
             updated_at = now()
       WHERE status = 'running'
         -- COALESCE, not a bare locked_at: NULL there would make the comparison NULL and the row
         -- unreclaimable, which is precisely the state this exists to clean up.
         AND COALESCE(locked_at, updated_at) < now() - make_interval(secs => $1)
       RETURNING id, document_id, mode, status, attempts`,
      [STALE_CLAIM_SECONDS, MAX_JOB_ATTEMPTS]
    );

    for (const job of res.rows) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexIngestJobReclaimed",
          jobId: job.id,
          documentId: job.document_id,
          mode: job.mode,
          attempts: job.attempts,
          outcome: job.status
        })
      );
      if (
        job.status === "failed" &&
        (job.mode === "full" || job.mode === "reindex")
      ) {
        await this.setStatus(
          job.document_id,
          "failed",
          "Processing was interrupted repeatedly. Use Retry to try again."
        );
      }
    }
  }

  private async drainLoop(): Promise<void> {
    while (await this.processOne()) {
      /* keep draining */
    }
  }

  /** Claims and processes one queued job. Returns false when the queue is empty. */
  private async processOne(): Promise<boolean> {
    const claim = await this.pg.query<JobRow>(
      `UPDATE lex_ingestion_jobs
         SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
       WHERE id = (
         SELECT id FROM lex_ingestion_jobs
         WHERE status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, document_id, mode`
    );
    if (claim.rows.length === 0) return false;

    const job = claim.rows[0];
    try {
      await this.runPipeline(job.document_id, job.mode);
      await this.pg.query(
        `UPDATE lex_ingestion_jobs SET status = 'done', updated_at = now() WHERE id = $1`,
        [job.id]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "lexIngestFailed",
          documentId: job.document_id,
          mode: job.mode,
          error: msg
        })
      );
      await this.pg.query(
        `UPDATE lex_ingestion_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
        [job.id, msg]
      );
      // Only the modes that PRODUCE the document's indexed text may declare the document failed.
      // 'pages' and 'resummarize' refresh metadata alongside a document that is already indexed and
      // already answering questions, so failing one must not repaint a working file as broken —
      // a maintenance action that can break the thing it maintains is worse than no action.
      if (job.mode === "full" || job.mode === "reindex") {
        await this.setStatus(job.document_id, "failed", msg);
      }
    }
    return true;
  }

  private async setStatus(
    documentId: string,
    status: LexParseStatus,
    error?: string
  ): Promise<void> {
    await this.pg.query(
      `UPDATE lex_documents SET parse_status = $2, error = $3, updated_at = now() WHERE id = $1`,
      [documentId, status, error ?? null]
    );
  }

  private async runPipeline(documentId: string, mode: JobMode): Promise<void> {
    const docRes = await this.pg.query<DocRow>(
      `SELECT id, workspace_id, owner_email, filename, content_type, s3_key, transcript
       FROM lex_documents WHERE id = $1`,
      [documentId]
    );
    if (docRes.rows.length === 0) throw new Error("document row vanished");
    const doc = docRes.rows[0];

    // Page-index-only rebuild. Routed first, and before anything that costs money: this mode's
    // whole reason to exist is that it is free, so it must never fall through into a paid step.
    if (mode === "pages") {
      await this.buildPageIndexOnly(doc);
      return;
    }

    // Metadata-only refresh: reuse the indexed text, leave chunks and embeddings alone.
    if (mode === "resummarize") {
      await this.resummarize(doc);
      return;
    }

    // 1. Acquire the document text: the stored transcript on a reindex, else parse the source
    //    (with OCR / transcription as needed). Returns null when the doc is parked (needs_ocr).
    const parsed =
      mode === "reindex"
        ? this.textFromStoredTranscript(doc)
        : await this.deriveText(doc);
    if (!parsed) return;

    // 2. Chunk (offsets validated by round-trip). Every page arriving here is already
    //    sanitised — see textSource / parseDocument — because sanitising after this point would
    //    move the text under the char offsets the chunks are about to be stored with.
    await this.setStatus(documentId, "chunking");
    const { fullText, pageRanges } = buildFullText(parsed.pages);

    // A document that yields no text must not reach 'ready' with zero chunks: it would look
    // indexed in the UI while being invisible to every retrieval path. Failing says so out loud.
    if (fullText.trim().length === 0) {
      throw new Error(
        `No text could be extracted from "${doc.filename}". If it is a scan, re-upload it as a PDF or image so it can be OCR'd.`
      );
    }

    // Duplicate check, now that the text exists (the resummarize mode returned above, so this
    // only runs on a real ingest). Bail out BEFORE embedding: a duplicate must not produce
    // chunks, or the same passage becomes citable from two documents.
    if (await this.markIfDuplicate(doc, fullText)) return;

    const chunks = chunkText(fullText, pageRanges);
    for (const c of chunks) {
      if (fullText.slice(c.charStart, c.charEnd) !== c.content) {
        throw new Error(`chunk offset mismatch at index ${c.chunkIndex}`);
      }
    }

    // 2b. Page index. Built from the SAME pageRanges the chunks were offset against, so the two
    //     grains agree and a citation resolved through one resolves through the other. No model
    //     calls, so 'ready' latency is unchanged.
    await this.writePageRows(doc, fullText, pageRanges, parsed);

    // 3. Embed + store (idempotent: clear any prior chunks first)
    await this.setStatus(documentId, "embedding");
    await this.pg.query(
      `DELETE FROM lex_document_chunks WHERE document_id = $1`,
      [documentId]
    );
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await this.openai.embed(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        await this.pg.query(
          `INSERT INTO lex_document_chunks
             (document_id, workspace_id, owner_email, chunk_index, page_from, page_to, char_start, char_end, content, token_count, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::halfvec)`,
          [
            documentId,
            doc.workspace_id,
            doc.owner_email,
            c.chunkIndex,
            c.pageFrom,
            c.pageTo,
            c.charStart,
            c.charEnd,
            c.content,
            c.tokenCount,
            `[${vectors[j].join(",")}]`
          ]
        );
      }
    }

    // 4. Summarize (in the owner's pinned language) + extract date, language, key names, tags.
    await this.setStatus(documentId, "summarizing");
    const meta = await this.summarize(
      doc.filename,
      fullText,
      await this.settings.languageOf(doc.owner_email)
    );

    await this.pg.query(
      `UPDATE lex_documents
         SET parse_status = 'ready', summary = $2, timeline_date = $3, page_count = $4,
             language = $5, key_names = $6::jsonb, tags = $7::jsonb, error = NULL, updated_at = now()
       WHERE id = $1`,
      [
        documentId,
        meta.summary,
        meta.date,
        parsed.pageCount,
        meta.language,
        JSON.stringify(meta.keyNames),
        JSON.stringify(meta.tags)
      ]
    );

    // Touch the workspace's rolling case state (rich memory lands with conversations).
    await this.pg.query(
      `INSERT INTO lex_case_state (workspace_id) VALUES ($1)
       ON CONFLICT (workspace_id) DO UPDATE SET updated_at = now()`,
      [doc.workspace_id]
    );
  }

  /**
   * Builds (or rebuilds) ONLY the per-page index of an already-indexed document, for free.
   *
   * Why it exists: a document ingested before the page index existed sits at page_index_version = 0
   * with no page rows, so RagService.retrievePinned falls back to the chunk grain — pinning p. 6
   * hands the model a 4000-char chunk covering pp. 4-8, and a quote from p. 8 is filed as "p. 4".
   *
   * Why it re-derives the text instead of reusing the chunks: page boundaries are NOT recoverable
   * from them. Measured over 361 recoverable boundaries in the real corpus, ZERO were exact and the
   * median uncertainty was 2204 chars against a median page of 2285 — a full page out. Page rows
   * built that way would label text "p. 7" that is really p. 6 or p. 8, and that text goes into a
   * Belgian court filing.
   *
   * Nothing about the document is touched except the page rows and page_index_version /
   * page_index_error: no re-embedding, no re-summarizing, no paid API call of any kind.
   */
  private async buildPageIndexOnly(doc: DocRow): Promise<void> {
    try {
      const source = await this.freePageText(doc);
      if (!source) return; // reason already recorded by freePageText

      const { fullText, pageRanges } = buildFullText(source.pages);
      if (fullText.trim().length === 0) {
        await this.stopPageIndex(
          doc,
          `No text could be read from "${doc.filename}", so page numbers cannot be added to it. Use this document's retry action to process it again.`
        );
        return;
      }

      // Verify the re-derivation against what is already indexed. The chunks were stored with
      // offsets into the fullText of their own ingest, so they are a free, exact witness to it.
      const indexed = await this.pg.query<{
        chunk_index: number;
        content: string;
        char_start: number | null;
        char_end: number | null;
      }>(
        `SELECT chunk_index, content, char_start, char_end FROM lex_document_chunks
         WHERE document_id = $1 ORDER BY chunk_index ASC`,
        [doc.id]
      );
      if (indexed.rows.length === 0) {
        // Nothing to stay consistent with, so nothing may be written: page rows offset against
        // unverified text are exactly what this mode refuses to produce.
        await this.stopPageIndex(
          doc,
          `"${doc.filename}" has no indexed text, so there is nothing to check a page numbering against. That is expected for a document set aside as a duplicate; otherwise use its retry action to process it.`
        );
        return;
      }
      const mismatch = firstSpanMismatch(
        fullText,
        indexed.rows.map((c) => ({
          chunkIndex: c.chunk_index,
          charStart: c.char_start,
          charEnd: c.char_end,
          content: c.content
        }))
      );
      if (mismatch) {
        await this.stopPageIndex(
          doc,
          `The text read from "${doc.filename}" today no longer matches the text that was indexed, so adding page numbers could point a citation at the wrong passage. Use this document's retry action to process it again.`,
          `chunk ${mismatch.chunkIndex} does not round-trip`
        );
        return;
      }

      await this.writePageRows(doc, fullText, pageRanges, source);
      this.logger.log(
        JSON.stringify({
          action: "lexPageIndexBackfilled",
          documentId: doc.id,
          filename: doc.filename,
          chunksVerified: indexed.rows.length
        })
      );
    } catch (err) {
      // Deliberately swallowed. processOne's failure handler sets parse_status = 'failed', which
      // would drop a document that is currently answering questions out of every retrieval path —
      // an unreadable S3 object or a parser throw is not a reason to break a working document over
      // an index it does not have today.
      await this.stopPageIndex(
        doc,
        `The page index for "${doc.filename}" could not be built. The document itself is unchanged and keeps working as before.`,
        err
      );
    }
  }

  /**
   * Acquires the document text for a 'pages' job without spending anything, or records why it
   * cannot and returns null.
   *
   * Both refusals are refusals of a PAID step, and both would be futile anyway: OCR and Whisper are
   * non-deterministic, so a second pass would not reproduce the text the chunks were built from and
   * would fail the verify step. Only a full re-ingest — which re-chunks against the new text — can
   * page-index those documents.
   */
  private async freePageText(doc: DocRow): Promise<TextSource | null> {
    // A voice note's indexed text IS its stored transcript (both 'full' and 'reindex' index from
    // it, and the user may have hand-corrected it), so reusing it reproduces the same fullText.
    const transcript = (doc.transcript ?? "").trim();
    if (transcript.length > 0) return this.textSource([transcript], 1, "blob");

    const { body } = await this.s3.get(doc.s3_key);
    const parsed = await parseDocument(
      body,
      doc.content_type ?? "",
      doc.filename
    );

    if (parsed.needsOcr) {
      await this.stopPageIndex(
        doc,
        `"${doc.filename}" is a scan, so page-exact citations for it need its text to be read from the image again. Use this document's retry action if you need them; until then it keeps answering exactly as it does today.`
      );
      return null;
    }
    if (parsed.needsTranscription) {
      await this.stopPageIndex(
        doc,
        `"${doc.filename}" is an audio recording and its transcript is no longer stored, so it would have to be transcribed again. Use this document's retry action if you need page-exact citations from it; until then it keeps answering exactly as it does today.`
      );
      return null;
    }

    return this.textSource(
      parsed.pages,
      parsed.pageCount,
      parsed.pageKind,
      parsed.sheetNames
    );
  }

  /**
   * Records why the page index could not be built, and returns normally so the job completes.
   *
   * A stop is an OUTCOME, not a crash: the document keeps its chunks, embeddings, summary and
   * 'ready' status and keeps answering through the chunk grain, exactly as before the backfill ran.
   * Failing the job instead would retry it forever and mark the document failed.
   *
   * page_index_error is the only column written — not even updated_at, which would make a
   * background backfill look like the user touched all 56 documents. The message is read by a
   * practitioner, not an engineer, so it names the file and the action that fixes it; the technical
   * detail goes to the log line instead.
   */
  private async stopPageIndex(
    doc: DocRow,
    reason: string,
    detail?: unknown
  ): Promise<void> {
    await this.pg.query(
      `UPDATE lex_documents SET page_index_error = $2 WHERE id = $1`,
      [doc.id, reason]
    );
    this.logger.warn(
      JSON.stringify({
        level: "warn",
        action: "lexPageIndexSkipped",
        documentId: doc.id,
        filename: doc.filename,
        reason,
        ...(detail === undefined ? {} : { detail: String(detail) })
      })
    );
  }

  /**
   * Writes the per-page index: exact text, exact char span, honest label, continuity flag and a
   * per-page fingerprint. No model calls.
   *
   * Rebuilt wholesale (DELETE then INSERT) rather than merged, because the offsets are only
   * meaningful against the fullText they were derived from — a partial update would leave rows
   * pointing into text that has moved.
   *
   * All of it in ONE transaction, because the DELETE has a side effect outside this table:
   * lex_citations.page_id is ON DELETE SET NULL, so it unanchors every page-anchored citation of
   * the document. A crash between the DELETE and the last INSERT would otherwise leave a half
   * index, unanchored citations, and page_index_version still claiming the state it had before.
   */
  private async writePageRows(
    doc: DocRow,
    fullText: string,
    pageRanges: { start: number; end: number }[],
    source: TextSource
  ): Promise<void> {
    const rows = buildPageRows(fullText, pageRanges, {
      kind: source.pageKind,
      sheetNames: source.sheetNames
    });
    assertPageRoundTrip(fullText, rows);

    await this.pg.withTransaction(async (client) => {
      await client.query(
        `DELETE FROM lex_document_pages WHERE document_id = $1`,
        [doc.id]
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO lex_document_pages
             (document_id, workspace_id, owner_email, ordinal, page_number, page_label,
              page_origin, char_start, char_end, text, char_count, token_count,
              text_fingerprint, continues_into_next)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            doc.id,
            doc.workspace_id,
            doc.owner_email,
            row.ordinal,
            row.pageNumber,
            row.pageLabel,
            row.pageOrigin,
            row.charStart,
            row.charEnd,
            row.text,
            row.charCount,
            row.tokenCount,
            row.textFingerprint,
            row.continuesIntoNext
          ]
        );
      }

      // Re-point the citations the DELETE just unanchored, but ONLY at a rebuilt page that still
      // holds the exact text the citation was made against. A page whose text moved must LOSE its
      // anchor and fall back to its char offsets rather than keep claiming a page it no longer
      // quotes. One statement, so a 400-page rebuild does not become 400 extra round trips.
      //
      // The hashes are computed in Node and shipped in as arrays because pgcrypto is not installed
      // (no digest() in SQL), and because lex_document_pages.text_fingerprint is the wrong hash for
      // a staleness test — see pageTextHash.
      await client.query(
        `UPDATE lex_citations c
            SET page_id = p.id
           FROM lex_document_pages p
           JOIN unnest($2::int[], $3::text[]) AS fresh(ordinal, text_hash)
             ON fresh.ordinal = p.ordinal
          WHERE p.document_id = $1
            AND c.document_id = $1
            AND c.page_id IS NULL
            AND c.page_ordinal = p.ordinal
            AND c.page_text_hash = fresh.text_hash`,
        [
          doc.id,
          rows.map((r) => r.ordinal),
          rows.map((r) => pageTextHash(r.text))
        ]
      );

      await client.query(
        `UPDATE lex_documents SET page_index_version = 1, page_index_error = NULL WHERE id = $1`,
        [doc.id]
      );
    });

    this.logger.log(
      JSON.stringify({
        action: "lexPageIndexBuilt",
        documentId: doc.id,
        pages: rows.length,
        origin: rows[0]?.pageOrigin
      })
    );
  }

  /**
   * Records the document's content hashes and, if another document in the workspace already has
   * the same content, marks this one as a duplicate of it.
   *
   * Two hashes, both exact:
   *  - sha256 of the bytes — the same file uploaded twice.
   *  - fingerprint of the normalised text — the same filing re-scanned or re-exported, where the
   *    bytes differ but the words do not.
   *
   * A duplicate is set to lifecycle_state 'superseded', which RagService's scope clause already
   * filters on, so it disappears from both vector and full-text retrieval without any change
   * there. It is kept (not deleted) so the user can see it arrived and decide.
   *
   * The primary is chosen as the OLDEST matching active document: the first copy filed wins, so
   * re-uploading never silently repoints existing citations at a different row.
   */
  private async markIfDuplicate(
    doc: DocRow,
    fullText: string
  ): Promise<boolean> {
    const { body } = await this.s3.get(doc.s3_key).catch(() => ({
      body: Buffer.alloc(0)
    }));
    const sha256 = body.length
      ? createHash("sha256").update(Uint8Array.from(body)).digest("hex")
      : null;
    const fingerprint = createHash("sha256")
      .update(normalizeForFingerprint(fullText))
      .digest("hex");

    await this.pg.query(
      `UPDATE lex_documents SET sha256 = COALESCE($2, sha256), text_fingerprint = $3 WHERE id = $1`,
      [doc.id, sha256, fingerprint]
    );

    const match = await this.pg.query<{ id: string; filename: string }>(
      `SELECT id, filename FROM lex_documents
       WHERE workspace_id = $1
         AND id <> $2
         AND lifecycle_state = 'active'
         AND duplicate_of IS NULL
         AND (text_fingerprint = $3 OR ($4::text IS NOT NULL AND sha256 = $4))
       ORDER BY created_at ASC
       LIMIT 1`,
      [doc.workspace_id, doc.id, fingerprint, sha256]
    );
    if (match.rows.length === 0) return false;

    const primary = match.rows[0];
    await this.pg.query(
      `UPDATE lex_documents
         SET parse_status = 'duplicate', lifecycle_state = 'superseded',
             duplicate_of = $2, error = NULL, updated_at = now()
       WHERE id = $1`,
      [doc.id, primary.id]
    );
    // Any chunks from a previous ingest of this row must go, or a superseded document could
    // still be reached if the lifecycle filter is ever relaxed. Page rows go with them: a
    // duplicate must not be page-routable either.
    await this.pg.query(
      `DELETE FROM lex_document_chunks WHERE document_id = $1`,
      [doc.id]
    );
    await this.pg.query(
      `DELETE FROM lex_document_pages WHERE document_id = $1`,
      [doc.id]
    );
    this.logger.log(
      JSON.stringify({
        action: "lexDuplicateDetected",
        documentId: doc.id,
        filename: doc.filename,
        duplicateOf: primary.id,
        primaryFilename: primary.filename
      })
    );
    return true;
  }

  /**
   * Redoes only the summary metadata, from text already indexed. The chunk rows and their
   * embeddings are deliberately left in place: nothing about the document changed, only the
   * language we want its summary written in.
   */
  private async resummarize(doc: DocRow): Promise<void> {
    const stored = (doc.transcript ?? "").trim();
    let fullText = stored;
    if (!fullText) {
      const chunks = await this.pg.query<{
        content: string;
        char_start: number | null;
        char_end: number | null;
      }>(
        `SELECT content, char_start, char_end FROM lex_document_chunks
         WHERE document_id = $1 ORDER BY chunk_index ASC`,
        [doc.id]
      );
      if (chunks.rows.length === 0)
        throw new Error("no indexed text to re-summarize");
      fullText = stitchChunks(
        chunks.rows.map((c) => ({
          content: c.content,
          charStart: c.char_start ?? 0,
          charEnd: c.char_end ?? c.content.length
        }))
      );
    }

    await this.setStatus(doc.id, "summarizing");
    const meta = await this.summarize(
      doc.filename,
      fullText,
      await this.settings.languageOf(doc.owner_email)
    );
    await this.pg.query(
      `UPDATE lex_documents
         SET parse_status = 'ready', summary = $2, timeline_date = $3,
             language = $4, key_names = $5::jsonb, tags = $6::jsonb,
             error = NULL, updated_at = now()
       WHERE id = $1`,
      [
        doc.id,
        meta.summary,
        meta.date,
        meta.language,
        JSON.stringify(meta.keyNames),
        JSON.stringify(meta.tags)
      ]
    );
  }

  /**
   * The single construction point for TextSource, and the last gate before text is chunked and
   * INSERTed. Sanitising here (not after chunking) keeps `fullText.slice(charStart, charEnd) ===
   * content` true, and it is what stops a NUL byte from aborting the chunk INSERT with
   * `invalid byte sequence for encoding "UTF8": 0x00`.
   */
  private textSource(
    pages: string[],
    pageCount: number,
    pageKind: TextSource["pageKind"] = "page",
    sheetNames?: string[]
  ): TextSource {
    return {
      pages: pages.map(sanitizeForStorage),
      pageCount,
      pageKind,
      sheetNames
    };
  }

  /** Re-index of a hand-corrected transcript: the text is already in the row, no API spend. */
  private textFromStoredTranscript(doc: DocRow): TextSource | null {
    const transcript = (doc.transcript ?? "").trim();
    if (transcript.length === 0)
      throw new Error("no stored transcript to re-index");
    // Sanitised too: rows written before this guard existed can still hold control characters.
    // 'blob': a transcript has no pages, so it is sectioned rather than given page numbers.
    return this.textSource([transcript], 1, "blob");
  }

  /**
   * Derives text from the S3 source: text layer, else OCR (scans/images), else transcription
   * (voice notes). Returns null when the document is parked as needs_ocr (nothing to index).
   */
  private async deriveText(doc: DocRow): Promise<TextSource | null> {
    await this.setStatus(doc.id, "parsing");
    const { body } = await this.s3.get(doc.s3_key);
    const parsed = await parseDocument(
      body,
      doc.content_type ?? "",
      doc.filename
    );
    // Visibility on the exact defect that killed documents in the first real bundle: which
    // files carry bytes Postgres would have rejected, and how much had to go.
    if (parsed.droppedChars > 0) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexTextSanitized",
          documentId: doc.id,
          filename: doc.filename,
          droppedChars: parsed.droppedChars
        })
      );
    }

    // Voice note → speech-to-text. The transcript is stored so it can be re-read and edited.
    if (parsed.needsTranscription) {
      await this.setStatus(doc.id, "transcribing");
      const { text, durationSeconds } = await this.openai.transcribe(
        body,
        doc.filename,
        doc.content_type ?? undefined
      );
      // Sanitised before the UPDATE: lex_documents.transcript is a text column too, and the
      // transcript is read back verbatim on a reindex.
      const transcript = sanitizeForStorage(text).trim();
      if (transcript.length === 0) throw new Error("transcription was empty");
      await this.pg.query(
        `UPDATE lex_documents
           SET transcript = $2, duration_seconds = $3, updated_at = now()
         WHERE id = $1`,
        [doc.id, transcript, durationSeconds]
      );
      // 'blob': speech has no pages; sectioning it is honest, "p. 1" would not be.
      return this.textSource([transcript], 1, "blob");
    }

    if (parsed.needsOcr) {
      if (!this.ocr.isConfigured()) {
        await this.pg.query(
          `UPDATE lex_documents SET parse_status = 'needs_ocr', page_count = $2, updated_at = now() WHERE id = $1`,
          [doc.id, parsed.pageCount]
        );
        return null; // no OCR configured — leave flagged for later
      }
      const ocrPages = await this.ocr.ocr(
        body,
        doc.content_type ?? "",
        doc.filename
      );
      if (ocrPages.length === 0) {
        await this.pg.query(
          `UPDATE lex_documents SET parse_status = 'needs_ocr', updated_at = now() WHERE id = $1`,
          [doc.id]
        );
        return null; // OCR yielded nothing usable
      }
      // OCR yields one entry per scanned page, so these are genuine pages.
      return this.textSource(ocrPages, ocrPages.length, "page");
    }

    return this.textSource(
      parsed.pages,
      parsed.pageCount,
      parsed.pageKind,
      parsed.sheetNames
    );
  }

  private async summarize(
    filename: string,
    fullText: string,
    language: LexLanguage
  ): Promise<{
    summary: string | null;
    date: string | null;
    language: string | null;
    keyNames: string[];
    tags: string[];
  }> {
    const empty = {
      summary: null,
      date: null,
      language: null,
      keyNames: [],
      tags: []
    };
    const raw = await this.openai.complete({
      json: true,
      system:
        "You are a legal analyst for Belgian-law court files. Be strictly factual and never invent details.",
      user:
        `Document filename: ${filename}\n\n` +
        `${fullText.slice(0, SUMMARY_INPUT_CHARS)}\n\n` +
        `Respond as JSON with exactly these keys:\n` +
        // The summary is read in the documents panel and timeline next to every other document,
        // so it follows the owner's pinned language — a mixed-language case file would otherwise
        // produce a timeline that switches language document by document. `language` still
        // records what the DOCUMENT itself is written in.
        `{"summary": "3-5 factual sentences written in ${languageName(language)} (whatever language the document itself is in), describing what this document is and its key facts",\n` +
        `"date": "the single most legally-relevant date as YYYY-MM-DD, or null if none is clear",\n` +
        `"language": "the language THE DOCUMENT ITSELF is written in, as a 2-letter code (fr, nl, en, ...)",\n` +
        `"keyNames": ["people, organisations, and parties named in the document"],\n` +
        `"tags": ["3-8 short topical tags for search"]}`
    });

    try {
      const parsed = summarizationResponseSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return empty;
      const d = parsed.data;
      // Sanitised here rather than at each call site: both runPipeline and resummarize write
      // these straight into text/jsonb columns. A model echoing a control character back out of
      // a badly-decoded document would otherwise fail the UPDATE and lose the whole ingest.
      return {
        summary: d.summary ? sanitizeForStorage(d.summary) : null,
        date: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null,
        language: d.language ? sanitizeForStorage(d.language) : null,
        keyNames: (d.keyNames ?? [])
          .filter((n) => typeof n === "string")
          .map(sanitizeForStorage),
        tags: (d.tags ?? [])
          .filter((t) => typeof t === "string")
          .map(sanitizeForStorage)
      };
    } catch {
      return empty;
    }
  }
}

const summarizationResponseSchema = z.object({
  summary: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  keyNames: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});
