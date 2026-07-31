import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type {
  LexLanguage,
  LexTaskEventKind,
  LexTaskKind
} from "@packages/types";
import type OpenAI from "openai";
import { z } from "zod";
import { ConfigService } from "../../config/config.service";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { quoteMatchesChunk } from "../artifacts/verification.service";
import { extractCitedIndexes } from "../conversations/citation-markers";
import { sanitizeForStorage, stitchChunks } from "../documents/chunker";
import {
  languageName,
  outputLanguageInstruction
} from "../settings/language-instruction";
import { SettingsService } from "../settings/settings.service";
import { TaskTrace } from "./task-trace";
import { TasksService } from "./tasks.service";

const POLL_INTERVAL_MS = 5000;

/**
 * How long a claim may go without a heartbeat before the task is considered dead. Every step
 * refreshes `locked_at` (TasksService.updateProgress), so the only thing that can go stale is a
 * process that actually died — five minutes is comfortably longer than one map call.
 */
const STALE_LOCK_SECONDS = 300;

/**
 * A task reclaimed this many times is failed instead of re-queued. Without it, a task that
 * reliably kills the process (an OOM on a monstrous document) would be re-claimed forever and
 * take the box down with it on every restart.
 */
const MAX_ATTEMPTS = 3;

/**
 * Per-call input ceiling, ~12k tokens at the ~3.4 chars/token this codebase estimates FR/NL prose
 * at. A 300-page exhibit is ~600k characters: without a cap it would either blow the context
 * window or cost more than the rest of the run put together.
 */
const MAX_DOC_CHARS_PER_CALL = 40000;

/**
 * How many of those windows a single document may consume. The cap bounds the worst case (a
 * 50-document run cannot silently become a 200-call run), and anything beyond it is reported as
 * partial coverage rather than quietly dropped — an assessment that omits half an exhibit without
 * saying so is worse than no assessment.
 */
const MAX_WINDOWS_PER_DOC = 4;

/**
 * Findings kept per model call. Per SECTION, not per document, on purpose: a 300-page exhibit read
 * in four sections genuinely has more to say than a one-page letter, and a per-document cap would
 * throw away the later sections' findings for no reason. Enough for a dense filing, low enough
 * that the reduce prompt stays inside its budget.
 */
const MAX_FINDINGS_PER_SECTION = 6;

/**
 * Total characters of findings the synthesis prompt may carry, ~59k tokens — under half of
 * gpt-4o's window, leaving room for the answer. Sized to fit a full 50-document run at the
 * per-document cap (300 findings of a few hundred characters each) without trimming; it exists so
 * a 500-document workspace degrades by dropping findings rather than by failing the call.
 */
const MAX_REDUCE_CHARS = 200000;

/** Quote length stored on a citation. Long enough to stand alone in a court document. */
const MAX_QUOTE_CHARS = 400;

/** The claimed row — includes the internal scheduling columns TasksService does not expose. */
interface ClaimedTaskRow {
  id: string;
  workspace_id: string;
  owner_email: string;
  conversation_id: string | null;
  kind: LexTaskKind;
  title: string;
  instructions: string | null;
  attempts: number;
}

interface DocRow {
  id: string;
  filename: string;
  page_count: number | null;
}

interface ChunkRow {
  id: string;
  content: string;
  char_start: number | null;
  char_end: number | null;
  page_from: number | null;
  page_to: number | null;
}

/** A chunk as the runner needs it: the citation anchor a finding is pinned to. */
interface SourceChunk {
  chunkId: string;
  content: string;
  charStart: number | null;
  charEnd: number | null;
  pageFrom: number | null;
  pageTo: number | null;
}

/**
 * One extracted finding, already anchored: the quote was found verbatim inside `chunk`, so the
 * claim it supports is traceable to an exact span of a real document. A finding that could not be
 * anchored never becomes one of these.
 */
interface LocatedFinding {
  documentId: string;
  filename: string;
  text: string;
  quote: string;
  chunk: SourceChunk;
}

const findingsResponseSchema = z.object({
  note: z.string().nullable().optional(),
  findings: z
    .array(
      z.object({
        text: z.string(),
        quote: z.string().nullable().optional()
      })
    )
    .nullable()
    .optional()
});

/**
 * The background reasoning worker: polls lex_tasks, claims one task at a time with
 * SELECT ... FOR UPDATE SKIP LOCKED, and runs a map/reduce read-through of a whole case file.
 *
 * CONCURRENCY IS 1, deliberately. A deep run is minutes of sequential model calls; running two
 * would double the wall-clock of both, starve the document-ingestion pool (which runs 3) and put
 * the Campaigns API — same small EC2, same event loop — behind a queue of long awaits. One task
 * at a time is also all a single user can read.
 *
 * Inert unless Lex is configured (DATABASE_URL present), so a Campaigns-only deploy never starts
 * it. Same shape as IngestionWorker, so it can be swapped for an SQS consumer without touching
 * the reasoning loop.
 */
@Injectable()
export class TaskRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskRunner.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private pg: PgService,
    private openai: OpenAiService,
    private tasks: TasksService,
    private settings: SettingsService,
    private config: ConfigService
  ) {}

  onModuleInit(): void {
    if (!this.config.get("DATABASE_URL")) {
      this.logger.log("Lex task runner idle (DATABASE_URL not configured)");
      return;
    }
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // one task at a time, ticks included
    this.running = true;
    try {
      await this.reclaimStale();
      while (await this.runOne()) {
        /* drain the queue, still strictly one at a time */
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "lexTaskTick",
          error: String(err)
        })
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Crash recovery. A task left 'running' by a process that died would otherwise sit there
   * forever, showing a spinner to a user whose work is never coming. Anything whose heartbeat has
   * gone stale is re-queued — unless it has already burned MAX_ATTEMPTS, in which case it is
   * failed with an honest message instead of looping.
   */
  private async reclaimStale(): Promise<void> {
    const res = await this.pg.query<{
      id: string;
      status: string;
      attempts: number;
    }>(
      `UPDATE lex_tasks
         SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
             error = CASE WHEN attempts >= $2
                          THEN 'The task was interrupted repeatedly and did not complete. '
                               || 'Try narrowing it to fewer documents.'
                          ELSE error END,
             step = NULL,
             locked_at = NULL,
             updated_at = now()
       WHERE status = 'running'
         -- COALESCE, not a bare locked_at: a NULL there would make the comparison NULL and the
         -- row unreclaimable, which is exactly the state this exists to clean up.
         AND COALESCE(locked_at, updated_at) < now() - make_interval(secs => $1)
       RETURNING id, status, attempts`,
      [STALE_LOCK_SECONDS, MAX_ATTEMPTS]
    );
    for (const row of res.rows) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexTaskReclaimed",
          taskId: row.id,
          attempts: row.attempts,
          newStatus: row.status
        })
      );
    }
  }

  /** Claims and runs one queued task. Returns false when the queue is empty. */
  private async runOne(): Promise<boolean> {
    const claim = await this.pg.query<ClaimedTaskRow>(
      `UPDATE lex_tasks
         SET status = 'running', attempts = attempts + 1, locked_at = now(),
             error = NULL, updated_at = now()
       WHERE id = (
         SELECT id FROM lex_tasks
         WHERE status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, workspace_id, owner_email, conversation_id, kind, title, instructions, attempts`
    );
    if (claim.rows.length === 0) return false;

    const task = claim.rows[0];
    const startedAt = Date.now();
    // Seeded from what is already persisted so a reclaimed run appends to its trace instead of
    // colliding on UNIQUE (task_id, seq).
    const trace = new TaskTrace(await this.tasks.lastEventSeq(task.id));

    try {
      await this.execute(task, trace);
      this.logger.log(
        JSON.stringify({
          action: "lexTaskFinished",
          taskId: task.id,
          attempts: task.attempts,
          durationMs: Date.now() - startedAt
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "lexTaskFailed",
          taskId: task.id,
          attempts: task.attempts,
          durationMs: Date.now() - startedAt,
          error: msg
        })
      );
      // Failed, not re-queued: a deep run costs real money and a deterministic error (an
      // unparseable instruction, a missing API key) would fail identically on every retry.
      // `attempts` guards crash-loops; a thrown error is reported to the user instead.
      //
      // The trace writes are best-effort: failing to record WHY must not stop the task being
      // marked failed, or the row would sit 'running' until the stale-lock sweep instead of
      // telling the user now.
      await this.emit(task.id, trace, "error", msg).catch(() => undefined);
      await this.flush(task.id, trace).catch(() => undefined);
      await this.tasks.finish(task.id, { status: "failed", error: msg });
    }
    return true;
  }

  private async execute(task: ClaimedTaskRow, trace: TaskTrace): Promise<void> {
    if (task.kind !== "assess_documents") {
      throw new Error(`Unsupported task kind "${task.kind}"`);
    }
    await this.assessDocuments(task, trace);
  }

  // ── The reasoning loop ────────────────────────────────────────────────────────────────

  /**
   * MAP over every ready document, then REDUCE the accumulated findings into one cited answer
   * posted into the conversation.
   *
   * The map/reduce split is not an implementation detail, it is the point: "assess all 47
   * documents for X" cannot fit in one context window, so each document is read on its own (with
   * only the findings — not the documents — carried forward), and the synthesis reasons over a few
   * hundred anchored findings instead of a million characters of exhibits.
   */
  private async assessDocuments(
    task: ClaimedTaskRow,
    trace: TaskTrace
  ): Promise<void> {
    const language = await this.settings.languageOf(task.owner_email);
    const docs = await this.readyDocuments(task.workspace_id, task.owner_email);

    if (docs.length === 0) {
      // Failing out loud beats posting an empty assessment: "nothing relevant was found" and
      // "nothing was read" are very different answers to a lawyer.
      const msg =
        "This workspace has no indexed documents to assess. Upload documents and wait for them to finish processing.";
      await this.emit(task.id, trace, "error", msg);
      await this.flush(task.id, trace);
      await this.tasks.finish(task.id, { status: "failed", error: msg });
      return;
    }

    await this.tasks.updateProgress(task.id, {
      done: 0,
      total: docs.length,
      step: `reading ${docs.length} documents`
    });
    await this.emit(
      task.id,
      trace,
      "progress",
      `Assessing ${docs.length} documents: ${task.title}`
    );

    const findings: LocatedFinding[] = [];
    /** Documents whose text exceeded MAX_WINDOWS_PER_DOC — surfaced in the answer as a caveat. */
    const partial: string[] = [];

    for (let i = 0; i < docs.length; i++) {
      if (await this.wasCancelled(task, trace, i, docs.length)) return;

      const doc = docs[i];
      const step = `reading ${doc.filename} (${i + 1}/${docs.length})`;
      await this.tasks.updateProgress(task.id, {
        done: i,
        total: docs.length,
        step
      });

      const { text, chunks } = await this.documentText(doc.id);
      if (text.trim().length === 0) {
        // 'ready' with no recoverable text should not happen, but a silent skip in a court tool
        // is unacceptable — record it in the trace so the gap is visible.
        await this.emit(
          task.id,
          trace,
          "progress",
          `${step} — no indexed text, skipped`
        );
        continue;
      }

      const windows = this.windowsOf(text);
      if (windows.truncated) partial.push(doc.filename);

      const before = findings.length;
      for (let w = 0; w < windows.parts.length; w++) {
        if (await this.wasCancelled(task, trace, i, docs.length)) return;
        const extracted = await this.extractFindings({
          task,
          language,
          doc,
          part: windows.parts[w],
          partIndex: w,
          partCount: windows.parts.length
        });
        if (extracted.note) {
          await this.emit(task.id, trace, "reasoning", `${extracted.note}\n`);
        }
        for (const f of extracted.findings) {
          const chunk = this.locate(f.quote, chunks);
          if (!chunk) {
            // The verbatim backstop, same gate as artifact verification: a quote that is not in
            // the stored document cannot be cited, so the finding is dropped rather than
            // carried into a filed answer with a fabricated source.
            await this.emit(
              task.id,
              trace,
              "reasoning",
              `(discarded an unverifiable finding from ${doc.filename}: its quote is not in the document)\n`
            );
            continue;
          }
          findings.push({
            documentId: doc.id,
            filename: doc.filename,
            text: f.text,
            quote: f.quote.slice(0, MAX_QUOTE_CHARS),
            chunk
          });
          await this.emit(
            task.id,
            trace,
            "finding",
            `${doc.filename}${chunk.pageFrom ? `, p.${chunk.pageFrom}` : ""}: ${f.text}`
          );
        }
      }

      await this.emit(
        task.id,
        trace,
        "progress",
        `${i + 1}/${docs.length} — ${doc.filename}: ${findings.length - before} relevant finding(s)` +
          (windows.truncated
            ? ` (only the first ${MAX_WINDOWS_PER_DOC} sections were read)`
            : "")
      );
      await this.tasks.updateProgress(task.id, {
        done: i + 1,
        total: docs.length,
        step
      });
    }

    if (await this.wasCancelled(task, trace, docs.length, docs.length)) return;

    // REDUCE. Run even with zero findings: the synthesis prompt already knows to say plainly that
    // the file does not answer the question, and it says it in the user's pinned language — which
    // a hardcoded English fallback here would not.
    await this.tasks.updateProgress(task.id, {
      done: docs.length,
      total: docs.length,
      step: `synthesising ${findings.length} findings`
    });
    await this.emit(
      task.id,
      trace,
      "progress",
      `Synthesising the answer from ${findings.length} findings across ${docs.length} documents`
    );

    const kept = this.budgetFindings(findings);
    if (kept.length < findings.length) {
      await this.emit(
        task.id,
        trace,
        "progress",
        `Too many findings for one synthesis: using the first ${kept.length} of ${findings.length}`
      );
    }

    const answer = await this.synthesise({
      task,
      language,
      findings: kept,
      documentCount: docs.length,
      partial,
      onDelta: (delta) => this.emit(task.id, trace, "reasoning", delta)
    });

    const messageId = await this.postResult(task, answer, kept);

    await this.emit(
      task.id,
      trace,
      "done",
      `Assessment complete: ${kept.length} cited findings from ${docs.length} documents.`
    );
    await this.flush(task.id, trace);
    await this.tasks.finish(task.id, {
      status: "done",
      resultMessageId: messageId
    });
  }

  /**
   * Cooperative cancellation, checked at every step boundary (and between the windows of a long
   * document, which are a model call each). Stopping between steps rather than mid-write means a
   * cancelled task never leaves a half-written message or an orphaned citation.
   */
  private async wasCancelled(
    task: ClaimedTaskRow,
    trace: TaskTrace,
    done: number,
    total: number
  ): Promise<boolean> {
    const status = await this.tasks.statusOf(task.id);
    if (status !== "cancelled") return false;
    await this.emit(
      task.id,
      trace,
      "done",
      `Cancelled by the user after ${done}/${total} documents.`
    );
    await this.flush(task.id, trace);
    await this.tasks.finish(task.id, { status: "cancelled" });
    this.logger.log(
      JSON.stringify({
        action: "lexTaskStoppedOnCancel",
        taskId: task.id,
        done,
        total
      })
    );
    return true;
  }

  /**
   * The documents in scope: indexed and current, read in legal-timeline order. Chronological
   * order is not cosmetic — an assessment reasons about what was known when, and it makes the
   * citation numbering follow the case rather than an upload accident.
   *
   * `parse_status = 'ready'` and `lifecycle_state = 'active'` are the same scope retrieval uses,
   * so duplicates and superseded copies cannot make one fact citable twice.
   */
  private async readyDocuments(
    workspaceId: string,
    ownerEmail: string
  ): Promise<DocRow[]> {
    const res = await this.pg.query<DocRow>(
      `SELECT id, filename, page_count FROM lex_documents
       WHERE workspace_id = $1 AND owner_email = $2
         AND parse_status = 'ready' AND lifecycle_state = 'active'
       ORDER BY timeline_date ASC NULLS LAST, created_at ASC`,
      [workspaceId, ownerEmail]
    );
    return res.rows;
  }

  /**
   * Rebuilds a document's text from its stored chunks — no S3 fetch, no OCR, no transcription
   * bill a second time. The chunks come back alongside it because they are the citation anchors
   * every finding has to land on.
   */
  private async documentText(documentId: string): Promise<{
    text: string;
    chunks: SourceChunk[];
  }> {
    const res = await this.pg.query<ChunkRow>(
      `SELECT id, content, char_start, char_end, page_from, page_to
       FROM lex_document_chunks
       WHERE document_id = $1
       ORDER BY chunk_index ASC`,
      [documentId]
    );
    const chunks: SourceChunk[] = res.rows.map((r) => ({
      chunkId: r.id,
      content: r.content,
      charStart: r.char_start,
      charEnd: r.char_end,
      pageFrom: r.page_from,
      pageTo: r.page_to
    }));
    // stitchChunks, not a join: chunks overlap by design, and concatenating them would feed the
    // model every boundary passage twice.
    const text = stitchChunks(
      chunks.map((c) => ({
        content: c.content,
        charStart: c.charStart ?? 0,
        charEnd: c.charEnd ?? c.content.length
      }))
    );
    return { text, chunks };
  }

  /** Splits a document into per-call windows, reporting whether anything had to be left out. */
  private windowsOf(text: string): { parts: string[]; truncated: boolean } {
    const parts: string[] = [];
    for (
      let at = 0;
      at < text.length && parts.length < MAX_WINDOWS_PER_DOC;
      at += MAX_DOC_CHARS_PER_CALL
    ) {
      parts.push(text.slice(at, at + MAX_DOC_CHARS_PER_CALL));
    }
    return {
      parts,
      truncated: text.length > MAX_WINDOWS_PER_DOC * MAX_DOC_CHARS_PER_CALL
    };
  }

  /** Extracts task-relevant findings from one window of one document. */
  private async extractFindings(params: {
    task: ClaimedTaskRow;
    language: LexLanguage;
    doc: DocRow;
    part: string;
    partIndex: number;
    partCount: number;
  }): Promise<{
    note: string | null;
    findings: { quote: string; text: string }[];
  }> {
    const { task, language, doc, part, partIndex, partCount } = params;
    // The page count and the section marker tell the model what it is holding: "section 2 of 4 of
    // a 300-page exhibit" is read very differently from "a one-page letter".
    const where =
      (doc.page_count ? `, ${doc.page_count} pages` : "") +
      (partCount > 1 ? ` (section ${partIndex + 1} of ${partCount})` : "");

    const raw = await this.openai.complete({
      json: true,
      temperature: 0,
      maxTokens: 1500,
      system:
        "You are a legal analyst working through a Belgian-law court file one document at a " +
        "time. Extract ONLY what bears on the assessment the lawyer asked for — however " +
        "interesting the rest of the document is, it is noise here. Most documents in a case " +
        "file are irrelevant to any given question: an empty findings array is the expected " +
        "answer, never a failure. " +
        // Field-scoped language rule, NOT the shared outputLanguageInstruction: `quote` is
        // matched character-for-character against the stored document, so a translated or
        // tidied quote is silently discarded and its finding is lost.
        `Write "note" and every "text" in ${languageName(language)}. Every "quote" must be ` +
        `copied EXACTLY from the DOCUMENT text below — never translate, correct, shorten with ` +
        `ellipses or reformat it. A finding whose quote is not found verbatim in the document ` +
        `is discarded, so a fabricated quote loses you the finding.`,
      user:
        `ASSESSMENT: ${task.title}\n` +
        `${task.instructions ? `INSTRUCTIONS: ${task.instructions}\n` : ""}` +
        `DOCUMENT: ${doc.filename}${where}\n` +
        `---\n${part}\n---\n\n` +
        `Respond as JSON: {"note":"one sentence, what this document is and whether it bears ` +
        `on the assessment","findings":[{"text":"a self-contained finding relevant to the ` +
        `assessment","quote":"the verbatim excerpt from the document above that establishes ` +
        `it"}]}\n` +
        `At most ${MAX_FINDINGS_PER_SECTION} findings — the most relevant ones only.`
    });

    try {
      const parsed = findingsResponseSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return { note: null, findings: [] };
      const note = parsed.data.note?.trim();
      return {
        note: note ? sanitizeForStorage(note) : null,
        findings: (parsed.data.findings ?? [])
          .map((f) => ({
            text: sanitizeForStorage(f.text ?? "").trim(),
            quote: sanitizeForStorage(f.quote ?? "").trim()
          }))
          .filter((f) => f.text.length > 0 && f.quote.length > 0)
          .slice(0, MAX_FINDINGS_PER_SECTION)
      };
    } catch {
      // A malformed response costs one document's findings, not the run. The trace records the
      // document as yielding nothing, which is visible to the user.
      return { note: null, findings: [] };
    }
  }

  /**
   * Resolves a quote to the exact chunk it came from, deterministically.
   *
   * The model is NOT asked which chunk it quoted: it is asked for the quote, and the quote is
   * then located in the stored spans. That makes the anchor independent of the model's
   * bookkeeping and doubles as the hallucination gate — a quote that is nowhere in the document
   * has no chunk, so the finding cannot be cited at all.
   */
  private locate(quote: string, chunks: SourceChunk[]): SourceChunk | null {
    return chunks.find((c) => quoteMatchesChunk(quote, c.content)) ?? null;
  }

  /** Keeps findings in document order until the synthesis prompt budget is spent. */
  private budgetFindings(findings: LocatedFinding[]): LocatedFinding[] {
    const kept: LocatedFinding[] = [];
    let chars = 0;
    for (const f of findings) {
      chars += f.text.length + f.quote.length + f.filename.length;
      if (chars > MAX_REDUCE_CHARS) break;
      kept.push(f);
    }
    return kept;
  }

  /**
   * Synthesises the final answer from the anchored findings, streamed so a watching client sees
   * it being written (and so the trace records it for anyone who reconnects later).
   *
   * Findings are numbered and the model must cite them inline as [n] — the same convention
   * ContextAssembler builds its SOURCES block with and citation-markers.ts parses, so one
   * citation pipeline covers chat replies and assessments alike.
   */
  private async synthesise(params: {
    task: ClaimedTaskRow;
    language: LexLanguage;
    findings: LocatedFinding[];
    documentCount: number;
    partial: string[];
    onDelta: (delta: string) => Promise<void>;
  }): Promise<string> {
    const { task, language, findings, documentCount, partial } = params;

    const findingsBlock = findings.length
      ? findings
          .map(
            (f, i) =>
              `[${i + 1}] (${f.filename}${f.chunk.pageFrom ? `, p.${f.chunk.pageFrom}` : ""}): ` +
              `${f.text}\n    VERBATIM: "${f.quote}"`
          )
          .join("\n\n")
      : "(no relevant findings were extracted from the documents in this workspace)";

    const system =
      "You are Lex, a meticulous legal assistant for Belgian-law court files. You are writing " +
      "the conclusion of a full read-through of a case file: every document was read " +
      "separately and the relevant FINDINGS below are what came back, each with the verbatim " +
      "text that establishes it. Answer ONLY from these FINDINGS. Cite every factual claim " +
      "inline with its marker, e.g. [1] or [2] — this answer is filed in court, and an " +
      "uncited claim is unusable. If the FINDINGS do not answer the question, say so plainly " +
      "and do not speculate. Format your answer as Markdown: short paragraphs, `##` headings " +
      "when the answer has parts, bullet lists for enumerations, tables for comparisons, and " +
      "blockquotes for text quoted from a source. Never wrap the whole answer in a code fence.";

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      {
        role: "system",
        content:
          // "were read", not "were read in full": some may have been truncated below, and an
          // overstated coverage claim in a filed document is exactly the kind of error this
          // whole pipeline exists to avoid.
          `COVERAGE: ${documentCount} documents from this case file were read, one at a time.` +
          // Stated in the prompt, not just the trace: an answer built on a partially-read exhibit
          // must carry that caveat into the document that gets filed.
          (partial.length
            ? ` These documents were too long to read entirely, and only their first sections ` +
              `were assessed — say so explicitly in your answer: ${partial.join(", ")}.`
            : "")
      },
      { role: "system", content: `FINDINGS:\n${findingsBlock}` },
      // Last system message, so the language pin is the most recent instruction the model reads
      // (the findings and quotes are frequently in another language).
      { role: "system", content: outputLanguageInstruction(language) },
      {
        role: "user",
        content:
          `${task.title}` +
          `${task.instructions ? `\n\n${task.instructions}` : ""}`
      }
    ];

    let full = "";
    // temperature 0: an assessment that is filed in court should not vary run to run.
    for await (const delta of this.openai.streamChat(messages, {
      temperature: 0
    })) {
      full += delta;
      await params.onDelta(delta);
    }
    return sanitizeForStorage(full);
  }

  /**
   * Posts the answer into the task's conversation, so the result lands where the lawyer is
   * already reading instead of in a separate silo.
   *
   * Written as a user turn (the task's own title and instructions — that IS what was asked)
   * followed by the assistant answer, mirroring ConversationsService.streamReply: seq allocated
   * from MAX(seq), citations inserted only for the markers actually used, all in one transaction
   * so a message can never exist without its citations.
   */
  private async postResult(
    task: ClaimedTaskRow,
    answer: string,
    findings: LocatedFinding[]
  ): Promise<string | null> {
    // The conversation can have been deleted mid-run (FK is ON DELETE SET NULL). The trace is
    // still the record of the work, so this is a missing landing pad, not a failure.
    if (!task.conversation_id) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexTaskNoConversation",
          taskId: task.id
        })
      );
      return null;
    }

    const assistantId = randomUUID();
    const cited = extractCitedIndexes(answer, findings.length);

    await this.pg.withTransaction(async (client) => {
      // Lock the conversation before reading MAX(seq), and take the SAME lock
      // ConversationsService.streamReply takes. `seq` is UNIQUE per conversation, so without this
      // a chat turn sent while the run was finishing could claim the same seq and one of the two
      // would die on a unique violation — here, that would throw away the result of a run that
      // took ten minutes and real money.
      await client.query(
        `SELECT 1 FROM lex_conversations WHERE id = $1 FOR UPDATE`,
        [task.conversation_id]
      );
      const seqRes = await client.query<{ m: string }>(
        `SELECT COALESCE(MAX(seq), 0) AS m FROM lex_messages WHERE conversation_id = $1`,
        [task.conversation_id]
      );
      const base = Number(seqRes.rows[0].m);
      await client.query(
        `INSERT INTO lex_messages (conversation_id, owner_email, seq, role, content, status)
         VALUES ($1, $2, $3, 'user', $4, 'complete')`,
        [
          task.conversation_id,
          task.owner_email,
          base + 1,
          `${task.title}${task.instructions ? `\n\n${task.instructions}` : ""}`
        ]
      );
      await client.query(
        `INSERT INTO lex_messages
           (id, conversation_id, owner_email, seq, role, content, status, token_count)
         VALUES ($1, $2, $3, $4, 'assistant', $5, 'complete', $6)`,
        [
          assistantId,
          task.conversation_id,
          task.owner_email,
          base + 2,
          answer,
          Math.ceil(answer.length / 4)
        ]
      );
      for (const n of cited) {
        const f = findings[n - 1];
        if (!f) continue;
        await client.query(
          `INSERT INTO lex_citations
             (owner_email, message_id, chunk_id, document_id, quote, page_from, page_to,
              char_start, char_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            task.owner_email,
            assistantId,
            f.chunk.chunkId,
            f.documentId,
            f.quote,
            f.chunk.pageFrom,
            f.chunk.pageTo,
            f.chunk.charStart,
            f.chunk.charEnd
          ]
        );
      }
      await client.query(
        `UPDATE lex_conversations SET updated_at = now(), title = COALESCE(title, $2)
         WHERE id = $1`,
        [task.conversation_id, task.title.slice(0, 60)]
      );
    });

    this.logger.log(
      JSON.stringify({
        action: "lexTaskResultPosted",
        taskId: task.id,
        messageId: assistantId,
        findings: findings.length,
        cited: cited.length
      })
    );
    return assistantId;
  }

  // ── Trace plumbing ────────────────────────────────────────────────────────────────────

  /** Pushes into the batcher and persists whatever it decided is ready (usually nothing). */
  private async emit(
    taskId: string,
    trace: TaskTrace,
    kind: LexTaskEventKind,
    text: string
  ): Promise<void> {
    await this.tasks.appendEvents(taskId, trace.push(kind, text));
  }

  private async flush(taskId: string, trace: TaskTrace): Promise<void> {
    await this.tasks.appendEvents(taskId, trace.flush());
  }
}
