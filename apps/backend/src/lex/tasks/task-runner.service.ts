import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type {
  LexArtifactTaskParams,
  LexArtifactVerificationReport,
  LexAssessmentTaskParams,
  LexLanguage,
  LexTaskEventKind,
  LexTaskKind,
  LexTaskParams,
  LexVerifyArtifactTaskParams,
  ReasoningDepth
} from "@packages/types";
import type OpenAI from "openai";
import { z } from "zod";
import { ConfigService } from "../../config/config.service";
import { OpenAiService } from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { estimateTokens } from "../../shared/tokens";
import { ArtifactsService } from "../artifacts/artifacts.service";
import { quoteMatchesChunk } from "../artifacts/verification.service";
import { extractCitedIndexes } from "../conversations/citation-markers";
import { dateOnly } from "../documents/calendar-date";
import { CaseFileService } from "../documents/case-file.service";
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
 * How many of those windows a single document may consume: 480k characters, roughly a 190-page
 * filing. Anything beyond it is reported as partial coverage rather than quietly dropped — an
 * assessment that omits half an exhibit without saying so is worse than no assessment.
 *
 * This was 4 (160k chars, ~64 pages), which silently truncated the ordinary case this app exists
 * for: an 80-page set of conclusions is ~200k characters and lost its last quarter. The worst case
 * is now bounded by MAX_WINDOWS_PER_RUN instead, which is the bound that actually mattered.
 */
const MAX_WINDOWS_PER_DOC = 12;

/**
 * Total windows one run may read across ALL documents. This is the real cost ceiling: a
 * 50-document workspace at the per-document cap would otherwise be 600 model calls. Documents are
 * read in order, so the budget is spent on the earliest ones and every document that got less than
 * its full text is named in the answer's partial-coverage caveat.
 */
const MAX_WINDOWS_PER_RUN = 200;

/**
 * Findings kept per model call. Per SECTION, not per document, on purpose: a 300-page exhibit read
 * in four sections genuinely has more to say than a one-page letter, and a per-document cap would
 * throw away the later sections' findings for no reason. Enough for a dense filing, low enough
 * that the reduce prompt stays inside its budget.
 */
/**
 * How much of the file a run may fail to read and still answer.
 *
 * Above this it aborts instead of synthesising: a partial read produces an assessment that reads
 * exactly like a complete one, and the reader has no way to tell. Below it, the shortfall is
 * reported in the trace and the answer still carries the caveat about sections not read.
 */
const MAX_UNREADABLE_FRACTION = 0.1;

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
  /** How hard this run may think — chosen by the user, applied to both passes. */
  depth: ReasoningDepth;
  /** Kind-specific inputs; only `generate_artifact` fills this. */
  params: LexTaskParams | null;
  attempts: number;
}

interface DocRow {
  id: string;
  filename: string;
  page_count: number | null;
  /** The three below feed documentHeader. Already stored, so they cost a wider SELECT and nothing else. */
  timeline_date: Date | string | null;
  language: string | null;
  summary: string | null;
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
    private config: ConfigService,
    private artifacts: ArtifactsService,
    private caseFile: CaseFileService
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
       RETURNING id, workspace_id, owner_email, conversation_id, kind, title, instructions,
                 depth, params, attempts`
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
    if (task.kind === "generate_artifact") {
      await this.generateArtifact(task, trace);
      return;
    }
    if (task.kind === "verify_artifact") {
      await this.verifyArtifact(task, trace);
      return;
    }
    if (task.kind !== "assess_documents" && task.kind !== "adverse_case") {
      throw new Error(`Unsupported task kind "${task.kind}"`);
    }
    await this.assessDocuments(task, trace);
  }

  /**
   * Drafts a document and verifies every claim in it, as a background run.
   *
   * Here rather than behind the HTTP request it used to be, because the work outlives a request:
   * `/api/admin/lex/artifacts/generate` falls through to nginx's catch-all location and its DEFAULT
   * 60s read timeout, so anything past a minute came back as a 504 with no CORS header — which the
   * browser reports as a CORS policy failure, hiding the real cause. Nothing was persisted until
   * the end either, so a failure late in verification threw the whole run away.
   */
  private async generateArtifact(
    task: ClaimedTaskRow,
    trace: TaskTrace
  ): Promise<void> {
    const params = task.params as LexArtifactTaskParams | null;
    if (!params?.type) {
      throw new Error("generate_artifact task has no document type");
    }

    const scope =
      params.documentIds && params.documentIds.length > 0
        ? `${params.documentIds.length} pièce(s)`
        : "the whole case file";
    await this.emit(
      task.id,
      trace,
      "progress",
      `Drafting "${task.title}" from ${scope} (${params.sourceMode === "full" ? "full read" : "targeted search"})`
    );
    await this.tasks.updateProgress(task.id, {
      done: 0,
      total: 1,
      step: "reading the selected pièces"
    });

    const { artifact, version } = await this.artifacts.generate(
      task.owner_email,
      {
        workspaceId: task.workspace_id,
        conversationId: task.conversation_id ?? undefined,
        type: params.type,
        title: task.title,
        instructions: task.instructions ?? undefined,
        documentIds: params.documentIds,
        sourceMode: params.sourceMode,
        onProgress: async (p) => {
          if (p.phase === "drafting") {
            await this.emit(
              task.id,
              trace,
              "progress",
              `Read ${p.packSpans} passages across ${p.packDocuments} pièces — drafting`
            );
            await this.tasks.updateProgress(task.id, {
              done: 0,
              total: 1,
              step: `drafting from ${p.packSpans} passages`
            });
            return;
          }
          // Verification is the long half, and the only phase with a real denominator: one
          // frontier-model judge per claim. Reported per claim so the panel moves.
          await this.tasks.updateProgress(task.id, {
            done: p.done,
            total: p.total,
            step: `verifying claim ${p.done}/${p.total}`
          });
        }
      }
    );

    const report = version.verificationReport;
    await this.emit(
      task.id,
      trace,
      "progress",
      report
        ? `${report.supported}/${report.total} claims verified against the file`
        : "Document drafted"
    );

    const messageId = await this.postArtifactResult(task, artifact, version);
    await this.tasks.finish(task.id, {
      status: "done",
      resultMessageId: messageId,
      resultArtifactId: artifact.id
    });
  }

  /**
   * Re-verifies an edited draft, as a background run.
   *
   * A task for the same reason generation is one — a judge call per re-checked claim outruns
   * nginx's 60s read timeout — and it reports no result into a conversation: the lawyer is looking
   * at the document, which is where the new verdicts appear.
   */
  private async verifyArtifact(
    task: ClaimedTaskRow,
    trace: TaskTrace
  ): Promise<void> {
    const params = task.params as LexVerifyArtifactTaskParams | null;
    if (!params?.artifactId) {
      throw new Error("verify_artifact task names no artifact");
    }

    await this.emit(
      task.id,
      trace,
      "progress",
      `Re-verifying "${task.title}" against the case file`
    );
    await this.tasks.updateProgress(task.id, {
      done: 0,
      total: 1,
      step: "reading the cited passages"
    });

    const { version, judged, carriedForward } = await this.artifacts.reverify(
      task.owner_email,
      params.artifactId,
      async (p) => {
        await this.tasks.updateProgress(task.id, {
          done: p.done,
          total: p.total,
          step: `re-checking claim ${p.done}/${p.total}`
        });
      }
    );

    const report = version.verificationReport;
    await this.emit(
      task.id,
      trace,
      "progress",
      // Both numbers, because they answer different questions: what the document now stands at, and
      // how much of the re-check was actually paid for rather than carried forward from the last one.
      (report
        ? `${report.supported}/${report.total} claims established`
        : "Re-verified") + ` — ${judged} re-judged, ${carriedForward} unchanged`
    );

    await this.tasks.finish(task.id, {
      status: "done",
      resultArtifactId: params.artifactId
    });
  }

  /**
   * Posts the finished document into the conversation.
   *
   * The link is the point: the run is launched from the chat, so its result belongs in the chat
   * rather than somewhere the user has to go and find. The unsupported count is stated plainly —
   * a draft where the judge refused half the claims is not a draft to file, and burying that
   * behind a link is how it gets filed anyway.
   */
  private async postArtifactResult(
    task: ClaimedTaskRow,
    artifact: { id: string; title: string },
    version: { verificationReport?: LexArtifactVerificationReport | null }
  ): Promise<string | null> {
    if (!task.conversation_id) return null;
    const report = version.verificationReport;
    const verdict = report
      ? report.unsupported === 0
        ? `${report.supported}/${report.total} affirmations sourcées.`
        : `${report.supported}/${report.total} affirmations sourcées — ` +
          `${report.unsupported} sans source vérifiable, à revoir avant tout dépôt.`
      : "";

    const body =
      `**${artifact.title}** — document rédigé.\n\n${verdict}\n\n` +
      `[Ouvrir le document](/lex/artifacts/${artifact.id})`;

    // Same conversation lock as postResult and ConversationsService.streamReply: `seq` is UNIQUE
    // per conversation, so a chat turn sent while this lands would otherwise collide and one of the
    // two would be lost — here, the result of a run that cost minutes and real money.
    const assistantId = randomUUID();
    await this.pg.withTransaction(async (client) => {
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
        `INSERT INTO lex_messages (conversation_id, owner_email, seq, role, content, status, origin)
         VALUES ($1, $2, $3, 'user', $4, 'complete', 'artifact')`,
        [
          task.conversation_id,
          task.owner_email,
          base + 1,
          `Rédiger : ${task.title}${task.instructions ? `\n\n${task.instructions}` : ""}`
        ]
      );
      // 'artifact', not 'assessment': this row is a pointer to a document in another table, so
      // there is nothing in it worth a reserved slice of the context budget.
      await client.query(
        `INSERT INTO lex_messages
           (id, conversation_id, owner_email, seq, role, content, status, token_count, origin)
         VALUES ($1, $2, $3, $4, 'assistant', $5, 'complete', $6, 'artifact')`,
        [
          assistantId,
          task.conversation_id,
          task.owner_email,
          base + 2,
          body,
          estimateTokens(body)
        ]
      );
    });
    return assistantId;
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
    // The WHOLE case file, not only the pièces this run reads. A scoped run must still be able to
    // say "the answer is probably in the 2003 letter, which was not in your selection", and an
    // unscoped run must be able to name what the reading budget never reached.
    const manifest = await this.caseFile.manifest(
      task.owner_email,
      task.workspace_id
    );
    // A scoped run reads only the pièces the user selected. Reading all 47 documents to answer a
    // question about two of them costs minutes and money for findings the synthesis then has to
    // wade through, so the scope is the user's to set.
    const selected = (task.params as LexAssessmentTaskParams | null)
      ?.documentIds;
    const docs = await this.readyDocuments(
      task.workspace_id,
      task.owner_email,
      selected
    );

    if (docs.length === 0) {
      // Failing out loud beats posting an empty assessment: "nothing relevant was found" and
      // "nothing was read" are very different answers to a lawyer. A scoped run that matched
      // nothing says so in its own terms — otherwise the user is told to upload documents they
      // can see are already there.
      const msg = selected?.length
        ? `None of the ${selected.length} selected pièce(s) are indexed and active, so there is nothing to assess. Check they finished processing and were not superseded.`
        : "This workspace has no indexed documents to assess. Upload documents and wait for them to finish processing.";
      await this.emit(task.id, trace, "error", msg);
      await this.flush(task.id, trace);
      await this.tasks.finish(task.id, { status: "failed", error: msg });
      return;
    }

    // A scoped run intersects the selection with ready + active. Only the ALL-dropped case failed
    // loudly above; a partial drop was silent, and the user had no way to learn that the pièce they
    // pinned while it was still processing was simply not in the assessment.
    //
    // A set difference rather than `selected.length - docs.length`, because the DTO permits the
    // same id twice and that would invent a phantom.
    const returned = new Set(docs.map((d) => d.id));
    const dropped = (selected ?? []).filter((id) => !returned.has(id));
    if (dropped.length > 0) {
      await this.emit(
        task.id,
        trace,
        "progress",
        `${dropped.length} of the ${new Set(selected).size} selected pièce(s) are not indexed or no longer active and were NOT read`
      );
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
    /** Windows the model could not be made to read at all, and how many were attempted. */
    let windowsRead = 0;
    let windowsFailed = 0;
    let firstFailure: string | null = null;
    /** Documents the run budget never reached. Distinct from `partial`: these were not opened. */
    const unread: string[] = [];
    /** Windows handed out so far, whether or not the call succeeded — this spends the run budget. */
    let windowsPlanned = 0;

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

      const windows = this.windowsOf(
        text,
        MAX_WINDOWS_PER_RUN - windowsPlanned
      );
      // Zero windows means the RUN budget ran out before this document, not that the document was
      // too long — it can be a two-page letter that happened to sit at position thirty. Reporting
      // it as "only the first sections were assessed" would put a false coverage claim in a filed
      // answer, so the two states are carried separately all the way to the synthesis prompt.
      if (windows.parts.length === 0) unread.push(doc.filename);
      else if (windows.truncated) partial.push(doc.filename);
      windowsPlanned += windows.parts.length;

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
        windowsRead += 1;
        if (extracted.error) {
          // Visible in the trace as it happens: a run that quietly read 40% of the file and
          // answered anyway is the failure this whole subsystem exists to avoid.
          windowsFailed += 1;
          firstFailure ??= extracted.error;
          await this.emit(
            task.id,
            trace,
            "error",
            `could not read section ${w + 1} of ${doc.filename}: ${extracted.error}`
          );
          continue;
        }
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
            ? ` (only the first ${windows.parts.length} section(s) were read)`
            : "")
      );
      await this.tasks.updateProgress(task.id, {
        done: i + 1,
        total: docs.length,
        step
      });
    }

    if (await this.wasCancelled(task, trace, docs.length, docs.length)) return;

    // A few unreadable windows are a caveat; most of them is a different answer to a different
    // question. Synthesising over the remainder would produce a confident assessment of a file the
    // run never actually read — and "no counter-argument was found" is exactly the sentence a
    // practitioner must never be handed on the strength of a third of the evidence.
    if (windowsFailed > 0) {
      const ratio = windowsFailed / Math.max(1, windowsRead);
      await this.emit(
        task.id,
        trace,
        "progress",
        `${windowsFailed} of ${windowsRead} sections could not be read`
      );
      if (ratio > MAX_UNREADABLE_FRACTION) {
        throw new Error(
          `Read only ${windowsRead - windowsFailed} of ${windowsRead} sections — ` +
            `too little of the file to assess it. First failure: ${firstFailure}`
        );
      }
    }

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
      manifest: manifest?.text ?? null,
      findings: kept,
      // The count of documents actually opened, not the count in scope — `unread` and `dropped`
      // are named separately below so the answer cannot claim coverage it does not have.
      documentCount: docs.length - unread.length,
      partial,
      unread,
      droppedFromScope: dropped.length,
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
    ownerEmail: string,
    /**
     * Narrows the run to these documents. Undefined or empty means the whole case file, so an
     * unscoped task keeps its existing behaviour. The ready/active filter still applies on top:
     * a selection is a request to read LESS, never a way to force a superseded or unparsed copy
     * into an assessment.
     */
    documentIds?: string[]
  ): Promise<DocRow[]> {
    const scoped = documentIds && documentIds.length > 0;
    const res = await this.pg.query<DocRow>(
      `SELECT id, filename, page_count, timeline_date, language, summary FROM lex_documents
       WHERE workspace_id = $1 AND owner_email = $2
         AND parse_status = 'ready' AND lifecycle_state = 'active'
         ${scoped ? "AND id = ANY($3::uuid[])" : ""}
       ORDER BY timeline_date ASC NULLS LAST, created_at ASC`,
      scoped
        ? [workspaceId, ownerEmail, documentIds]
        : [workspaceId, ownerEmail]
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

  /**
   * Splits a document into per-call windows, reporting whether anything had to be left out.
   *
   * `budget` is the run's remaining window allowance; a document is capped by whichever of that
   * and MAX_WINDOWS_PER_DOC binds first. A budget of 0 yields no parts and truncated=true, so an
   * unread document is still named in the caveat rather than passing as fully read.
   */
  private windowsOf(
    text: string,
    budget: number
  ): { parts: string[]; truncated: boolean } {
    const allowed = Math.max(0, Math.min(MAX_WINDOWS_PER_DOC, budget));
    const parts: string[] = [];
    for (
      let at = 0;
      at < text.length && parts.length < allowed;
      at += MAX_DOC_CHARS_PER_CALL
    ) {
      parts.push(text.slice(at, at + MAX_DOC_CHARS_PER_CALL));
    }
    return {
      parts,
      truncated: text.length > allowed * MAX_DOC_CHARS_PER_CALL
    };
  }

  /**
   * What the model is told about a document before it reads a window of it.
   *
   * The filename, page count and section marker were all it had, so a 2003 letter answering a 1998
   * convention was read as a letter about nothing. The document's own date, language and summary
   * are already stored by the ingestion worker, so this costs a wider SELECT and nothing else.
   *
   * Deliberately ONE document's metadata and never the whole case file: this prompt runs once per
   * window, up to MAX_WINDOWS_PER_RUN times in a single run, so a 3000-token inventory here would
   * cost hundreds of thousands of prompt tokens for a call that cannot cite across documents
   * anyway. The full manifest goes into the synthesis instead, which runs once.
   */
  private documentHeader(
    doc: DocRow,
    partIndex: number,
    partCount: number
  ): string {
    const facts = [
      dateOnly(doc.timeline_date),
      doc.language,
      doc.page_count ? `${doc.page_count} pages` : null,
      partCount > 1 ? `section ${partIndex + 1} of ${partCount}` : null
    ].filter(Boolean);
    const summary = doc.summary
      ? sanitizeForStorage(doc.summary)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 400)
      : "";
    return (
      `DOCUMENT: ${doc.filename}${facts.length ? ` (${facts.join(", ")})` : ""}\n` +
      (summary ? `WHAT IT IS: ${summary}\n` : "")
    );
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
    /** Set when the window could not be read at all — an API failure, not an empty result. */
    error?: string;
  }> {
    const { task, language, doc, part, partIndex, partCount } = params;
    // What the model is holding: "section 2 of 4 of a 300-page exhibit dated 1998" is read very
    // differently from "a one-page letter".
    const header = this.documentHeader(doc, partIndex, partCount);

    let raw: string;
    try {
      raw = await this.openai.complete({
        // Per-window finding extraction — up to 224 calls in a single adverse-case run, and the
        // expensive half of the job. It used to be pinned to the cheap tier at `low` effort on the
        // reasoning that a missed finding is recoverable because every quote is gated verbatim
        // anyway. That is backwards: the gate stops a WRONG finding, it cannot recover a finding the
        // reader never made. What the cheap tier loses here is silent, and silence in a case file is
        // the failure that matters. So the user's depth applies to this pass too — a `thorough` run
        // reads all 224 windows on the frontier tier, which is why the UI states what it costs.
        depth: task.depth,
        json: true,
        maxTokens: 1500,
        system:
          (task.kind === "adverse_case"
            ? // Reading the file AGAINST her. The party is named by her in the title and is never
              // inferred: the app refuses to assign anyone a role, and this feature is not a licence
              // to start. Asking for the adverse material specifically is the point — a run that
              // returns only what helps her is the confirmation bias the exercise exists to break.
              `You are a legal analyst preparing a Belgian-law case. Your job here is ADVERSARIAL: ` +
              `read this document for whatever tells AGAINST the party named below, as opposing ` +
              `counsel would. Extract assertions, admissions, figures, dates and omissions that ` +
              `undermine that party's position or support the other side. Do NOT extract what ` +
              `helps them — a separate pass does that. Most documents contain nothing adverse: an ` +
              `empty findings array is the expected answer, never a failure. `
            : "You are a legal analyst working through a Belgian-law court file one document at a " +
              "time. Extract ONLY what bears on the assessment the lawyer asked for — however " +
              "interesting the rest of the document is, it is noise here. Most documents in a case " +
              "file are irrelevant to any given question: an empty findings array is the expected " +
              "answer, never a failure. ") +
          // Field-scoped language rule, NOT the shared outputLanguageInstruction: `quote` is
          // matched character-for-character against the stored document, so a translated or
          // tidied quote is silently discarded and its finding is lost.
          `Write "note" and every "text" in ${languageName(language)}. Every "quote" must be ` +
          `copied EXACTLY from the DOCUMENT text below — never translate, correct, shorten with ` +
          `ellipses or reformat it. A finding whose quote is not found verbatim in the document ` +
          `is discarded, so a fabricated quote loses you the finding.`,
        user:
          (task.kind === "adverse_case"
            ? `PARTY BEING DEFENDED: ${task.title}\n`
            : `ASSESSMENT: ${task.title}\n`) +
          `${task.instructions ? `INSTRUCTIONS: ${task.instructions}\n` : ""}` +
          header +
          `---\n${part}\n---\n\n` +
          `Respond as JSON: {"note":"one sentence, what this document is and whether it bears ` +
          `on the assessment","findings":[{"text":"a self-contained finding relevant to the ` +
          `assessment","quote":"the verbatim excerpt from the document above that establishes ` +
          `it"}]}\n` +
          `At most ${MAX_FINDINGS_PER_SECTION} findings — the most relevant ones only.`
      });
    } catch (err) {
      // The CALL is inside the try, not just the parse. It was outside, and the truncation guard
      // added to OpenAiService.complete then turned one over-long window into a thrown error that
      // escaped to the task handler, which marks the run failed and does NOT re-queue it: 223 good
      // extractions discarded because the 224th did not fit. A window is the unit of loss here.
      //
      // Reported, never swallowed — the caller counts these and refuses to synthesise a confident
      // answer out of a file it mostly failed to read.
      return { note: null, findings: [], error: String(err) };
    }

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
    /** The CASE FILE block, or null when the workspace has no documents or the read failed. */
    manifest: string | null;
    findings: LocatedFinding[];
    documentCount: number;
    partial: string[];
    /** Documents in scope the run budget never reached. Named in the answer as NOT read. */
    unread: string[];
    /** Selected pièces excluded because they are not indexed or no longer active. */
    droppedFromScope: number;
    onDelta: (delta: string) => Promise<void>;
  }): Promise<string> {
    const {
      task,
      language,
      manifest,
      findings,
      documentCount,
      partial,
      unread,
      droppedFromScope
    } = params;

    const findingsBlock = findings.length
      ? findings
          .map(
            (f, i) =>
              `[${i + 1}] (${f.filename}${f.chunk.pageFrom ? `, p.${f.chunk.pageFrom}` : ""}): ` +
              `${f.text}\n    VERBATIM: "${f.quote}"`
          )
          .join("\n\n")
      : "(no relevant findings were extracted from the documents in this workspace)";

    /**
     * The adverse read is the one place this app takes a position, so the rules it works under are
     * stricter, not looser.
     *
     * Every contention must rest on a finding that already passed the verbatim gate, so the app can
     * only ever say "this is asserted, here is where". The STRENGTH of a contention and the answer
     * to it are judgement, and must be written as judgement rather than as fact — the reader is a
     * practitioner who will discount an opinion but may act on a statement.
     *
     * The most important rule is the last one: an absence in the FINDINGS is an absence IN THE FILE
     * AS READ, never proof that no answer exists. On a case where the app has read 54 documents and
     * the opponent has filed more, "no counter-argument was found" would be a dangerous thing to
     * read as "you have no counter-argument".
     */
    const system =
      task.kind === "adverse_case"
        ? "You are Lex, preparing a Belgian-law case AGAINST the party named by the user, so that " +
          "their own counsel can see the case coming. Every document in the file was read " +
          "separately and the ADVERSE FINDINGS below are what came back, each with the verbatim " +
          "text that establishes it. " +
          "Organise your answer by LEGAL ISSUE (rapport, réserve, réduction, recel, prescription, " +
          "usufruit, indivision, or whatever the findings actually raise — do not invent issues " +
          "the findings do not support). Under each issue: state the contention as opposing " +
          "counsel would put it, cite every factual element inline with its marker [1], then give " +
          "your assessment of how strongly the file supports it and what would answer it. " +
          'Mark judgement AS judgement: write "à mon sens", "cette contention paraît", ' +
          '"il me semble" for anything that is not directly in a finding, so the reader can tell ' +
          "an argument from a fact. " +
          "Where the findings contain nothing answering a contention, say that NOTHING ANSWERING " +
          "IT WAS FOUND IN THE DOCUMENTS READ — never that no answer exists. The file read here " +
          "may be incomplete, and the difference matters. " +
          "Finish with the two or three points that most need work, ordered by exposure. " +
          "Format as Markdown: `##` per issue, short paragraphs, blockquotes for quoted text. " +
          "Never wrap the whole answer in a code fence."
        : "You are Lex, a meticulous legal assistant for Belgian-law court files. You are writing " +
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
            : "") +
          // A different caveat from the one above, and a graver one. "Only the first sections"
          // still describes a document that was opened; these were not opened at all, so an
          // answer that folds them into the same sentence overstates its own coverage.
          (unread.length
            ? ` These documents were NOT read at all — the run's reading budget was exhausted ` +
              `before reaching them. State plainly that the assessment does not cover them: ` +
              `${unread.join(", ")}.`
            : "") +
          (droppedFromScope
            ? ` ${droppedFromScope} further pièce(s) the user selected were excluded because they ` +
              `are not indexed or no longer active, and were not read either — say so.`
            : "")
      },
      // Between COVERAGE and FINDINGS on purpose. COVERAGE says what this run actually read and
      // must win any conflict with the inventory; the inventory says what exists, which is what
      // turns "no counter-argument was found" into "nothing answering it was found in the 47
      // documents read, and 6 more were never opened".
      ...(manifest
        ? [
            {
              role: "system" as const,
              content:
                manifest +
                "\n\nTHE COVERAGE BLOCK ABOVE OVERRIDES THIS ONE for what was actually read. A " +
                "document listed here as INDEXED but named above as unread, or as only partly " +
                "read, was not assessed. Do not cite from this block: every [n] in your answer " +
                "is a FINDING."
            }
          ]
        : []),
      {
        role: "system",
        content:
          (task.kind === "adverse_case" ? "ADVERSE FINDINGS" : "FINDINGS") +
          `:\n${findingsBlock}`
      },
      // Last system message, so the language pin is the most recent instruction the model reads
      // (the findings and quotes are frequently in another language).
      { role: "system", content: outputLanguageInstruction(language) },
      {
        role: "user",
        content:
          (task.kind === "adverse_case"
            ? `Partie défendue : ${task.title}. Construisez le dossier qui lui est opposé.`
            : task.title) +
          `${task.instructions ? `\n\n${task.instructions}` : ""}`
      }
    ];

    let full = "";
    // The reasoning models reject a temperature, so an assessment may now vary in WORDING between
    // runs. Its substance cannot: every finding it draws on has already passed the verbatim gate
    // against the stored document, so a rerun can say the same thing differently but cannot say
    // something the file does not support.
    for await (const delta of this.openai.streamChat(messages, {
      depth: task.depth,
      // Named apart from the chat turn on purpose: this prompt is a fresh findings dump every
      // time and shares no prefix with anything, so its cache figures would drag the chat
      // averages down for a reason that is not a problem.
      caller: `task:${task.kind}`,
      blocks: ["taskSystem", ...(manifest ? ["caseFile"] : []), "findings"]
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
      // Both rows carry origin 'assessment', so the pair is protected together when the context
      // assembler decides what a later turn still gets to see. The answer without the question it
      // answered is an unattributed wall of findings.
      await client.query(
        `INSERT INTO lex_messages (conversation_id, owner_email, seq, role, content, status, origin)
         VALUES ($1, $2, $3, 'user', $4, 'complete', 'assessment')`,
        [
          task.conversation_id,
          task.owner_email,
          base + 1,
          `${task.title}${task.instructions ? `\n\n${task.instructions}` : ""}`
        ]
      );
      await client.query(
        `INSERT INTO lex_messages
           (id, conversation_id, owner_email, seq, role, content, status, token_count, origin)
         VALUES ($1, $2, $3, $4, 'assistant', $5, 'complete', $6, 'assessment')`,
        [
          assistantId,
          task.conversation_id,
          task.owner_email,
          base + 2,
          answer,
          estimateTokens(answer)
        ]
      );
      for (const n of cited) {
        const f = findings[n - 1];
        if (!f) continue;
        await client.query(
          `INSERT INTO lex_citations
             (owner_email, message_id, marker_index, chunk_id, document_id, quote, page_from,
              page_to, char_start, char_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            task.owner_email,
            assistantId,
            // The finding's number, which is the [n] the answer cites it by. An assessment over a
            // large file cites into the [300]s, and without this the reader had a bracketed number
            // with nothing behind it — see the marker_index migration.
            n,
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
