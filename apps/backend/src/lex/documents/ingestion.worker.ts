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

const POLL_INTERVAL_MS = 5000;
const EMBED_BATCH = 64;
const SUMMARY_INPUT_CHARS = 12000;
// Concurrent in-process workers draining the job queue (each claims its own job via
// FOR UPDATE SKIP LOCKED). Kept small so ingestion never starves the Campaigns API on the
// shared box; OCR/transcription are offloaded to APIs so these workers mostly orchestrate.
const POOL_SIZE = 3;

/**
 * full        — derive the text from the S3 source (parse / OCR / transcribe), then index.
 * reindex     — reuse the stored transcript (hand-corrected by the user), then index. Skips the
 *               transcription spend, which is the whole point of storing the transcript.
 * resummarize — redo ONLY step 4 (summary/date/language/names/tags) from the already-stored
 *               chunks. Chunks and embeddings are left untouched, and neither OCR nor
 *               transcription is paid for again. Used to bring existing documents into line
 *               after the owner changes their pinned language.
 */
type JobMode = "full" | "reindex" | "resummarize";

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
          error: msg
        })
      );
      await this.pg.query(
        `UPDATE lex_ingestion_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
        [job.id, msg]
      );
      await this.setStatus(job.document_id, "failed", msg);
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
    // still be reached if the lifecycle filter is ever relaxed.
    await this.pg.query(
      `DELETE FROM lex_document_chunks WHERE document_id = $1`,
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
  private textSource(pages: string[], pageCount: number): TextSource {
    return { pages: pages.map(sanitizeForStorage), pageCount };
  }

  /** Re-index of a hand-corrected transcript: the text is already in the row, no API spend. */
  private textFromStoredTranscript(doc: DocRow): TextSource | null {
    const transcript = (doc.transcript ?? "").trim();
    if (transcript.length === 0)
      throw new Error("no stored transcript to re-index");
    // Sanitised too: rows written before this guard existed can still hold control characters.
    return this.textSource([transcript], 1);
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
      return this.textSource([transcript], 1);
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
      return this.textSource(ocrPages, ocrPages.length);
    }

    return this.textSource(parsed.pages, parsed.pageCount);
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
