import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type {
  CreateTaskRequest,
  LexTask,
  LexTaskEvent,
  LexTaskEventKind,
  LexTaskKind,
  LexTaskStatus
} from "@packages/types";
import { PgService } from "../../shared/pg.service";
import { ConversationsService } from "../conversations/conversations.service";
import { sanitizeForStorage } from "../documents/chunker";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { PendingTaskEvent } from "./task-trace";

/**
 * Ceiling on one replay page. A real run writes a few hundred events (one note and a handful of
 * findings per document, plus the synthesis in ~400-character slices), so this is headroom, not
 * a pager — and it stops a pathological trace from being loaded into memory in one go.
 */
const EVENT_PAGE_LIMIT = 2000;

interface TaskRow {
  id: string;
  workspace_id: string;
  owner_email: string;
  conversation_id: string | null;
  kind: LexTaskKind;
  title: string;
  instructions: string | null;
  status: LexTaskStatus;
  progress_done: number;
  progress_total: number;
  step: string | null;
  result_message_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Every column mapTask needs. `attempts` and `locked_at` are deliberately absent: they are the
 * worker's crash-recovery bookkeeping, not part of the exposed contract (LexTask has no field
 * for either), and surfacing them would invite the client to reason about scheduling.
 */
const TASK_COLUMNS = `id, workspace_id, owner_email, conversation_id, kind, title, instructions,
  status, progress_done, progress_total, step, result_message_id, error, created_at, updated_at`;

interface TaskEventRow {
  /** BIGSERIAL — the pg driver returns int8 as a string. */
  id: string;
  task_id: string;
  seq: number;
  kind: LexTaskEventKind;
  message: string;
  created_at: Date;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export function mapTask(r: TaskRow): LexTask {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerEmail: r.owner_email,
    conversationId: r.conversation_id,
    kind: r.kind,
    title: r.title,
    instructions: r.instructions,
    status: r.status,
    progressDone: r.progress_done,
    progressTotal: r.progress_total,
    step: r.step,
    resultMessageId: r.result_message_id,
    error: r.error,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

function mapTaskEvent(r: TaskEventRow): LexTaskEvent {
  return {
    id: Number(r.id),
    taskId: r.task_id,
    seq: r.seq,
    kind: r.kind,
    message: r.message,
    createdAt: iso(r.created_at)
  };
}

/** The outcome of a run, as TaskRunner reports it back. */
export interface TaskOutcome {
  status: Extract<LexTaskStatus, "done" | "failed" | "cancelled">;
  resultMessageId?: string | null;
  error?: string | null;
}

/**
 * Background reasoning tasks: the queue rows, the persisted trace, and the ownership boundary
 * around both. TaskRunner does the work; everything a request handler is allowed to do lives
 * here, and every read is scoped by owner_email.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private pg: PgService,
    private workspaces: WorkspacesService,
    private conversations: ConversationsService
  ) {}

  /**
   * Queues a task. The row is 'queued' and the worker picks it up on its next tick — the request
   * returns immediately, which is the whole point: the lawyer launches this and closes the tab.
   *
   * A conversation is resolved (or created) up front so the finished answer always has somewhere
   * to land. Creating it here rather than at the end means the client can navigate to the thread
   * while the task is still running.
   */
  async create(ownerEmail: string, dto: CreateTaskRequest): Promise<LexTask> {
    await this.workspaces.getOrFail(ownerEmail, dto.workspaceId);

    let conversationId = dto.conversationId ?? null;
    if (conversationId) {
      // A conversation from ANOTHER workspace would file this assessment against the wrong case,
      // which is worse than a 400. Ownership is checked by getOrFail; the workspace is checked here.
      const conv = await this.conversations.getOrFail(
        ownerEmail,
        conversationId
      );
      if (conv.workspaceId !== dto.workspaceId) {
        throw new BadRequestException(
          "Conversation belongs to a different workspace"
        );
      }
    } else {
      const conv = await this.conversations.create(
        ownerEmail,
        dto.workspaceId,
        {
          title: dto.title
        }
      );
      conversationId = conv.id;
    }

    const res = await this.pg.query<TaskRow>(
      `INSERT INTO lex_tasks
         (workspace_id, owner_email, conversation_id, kind, title, instructions, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued')
       RETURNING ${TASK_COLUMNS}`,
      [
        dto.workspaceId,
        ownerEmail,
        conversationId,
        dto.kind,
        dto.title,
        dto.instructions ?? null
      ]
    );

    const task = mapTask(res.rows[0]);
    this.logger.log(
      JSON.stringify({
        action: "lexTaskQueued",
        taskId: task.id,
        workspaceId: task.workspaceId,
        kind: task.kind
      })
    );
    return task;
  }

  async list(ownerEmail: string, workspaceId: string): Promise<LexTask[]> {
    await this.workspaces.getOrFail(ownerEmail, workspaceId);
    const res = await this.pg.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM lex_tasks
       WHERE workspace_id = $1 AND owner_email = $2
       ORDER BY created_at DESC`,
      [workspaceId, ownerEmail]
    );
    return res.rows.map(mapTask);
  }

  async getOrFail(ownerEmail: string, id: string): Promise<LexTask> {
    const res = await this.pg.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM lex_tasks WHERE id = $1 AND owner_email = $2`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0) throw new NotFoundException("Task not found");
    return mapTask(res.rows[0]);
  }

  /**
   * Cancels a task that has not finished. Cooperative by design: the row flips immediately (so
   * the queue will never start it) and a run already in flight notices at its next step boundary
   * and stops cleanly, rather than being killed mid-write.
   */
  async cancel(ownerEmail: string, id: string): Promise<LexTask> {
    const res = await this.pg.query<TaskRow>(
      `UPDATE lex_tasks SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND owner_email = $2 AND status IN ('queued', 'running')
       RETURNING ${TASK_COLUMNS}`,
      [id, ownerEmail]
    );
    if (res.rows.length === 0) {
      // Distinguish "not yours / gone" (404) from "already finished" (400).
      const existing = await this.getOrFail(ownerEmail, id);
      throw new BadRequestException(
        `Task is already ${existing.status} and cannot be cancelled`
      );
    }
    this.logger.log(JSON.stringify({ action: "lexTaskCancelled", taskId: id }));
    return mapTask(res.rows[0]);
  }

  /**
   * The persisted trace from `afterSeq` onwards — what makes a background task watchable at all.
   * A client that connects an hour late replays from 0; one whose connection dropped resumes from
   * the last seq it saw.
   */
  async events(
    ownerEmail: string,
    taskId: string,
    afterSeq = 0
  ): Promise<LexTaskEvent[]> {
    await this.getOrFail(ownerEmail, taskId); // ownership
    const res = await this.pg.query<TaskEventRow>(
      `SELECT id, task_id, seq, kind, message, created_at FROM lex_task_events
       WHERE task_id = $1 AND seq > $2
       ORDER BY seq ASC
       LIMIT $3`,
      [taskId, afterSeq, EVENT_PAGE_LIMIT]
    );
    return res.rows.map(mapTaskEvent);
  }

  // ── Runner-facing writes ────────────────────────────────────────────────────────────
  // No ownership arguments: TaskRunner already holds a claimed row, and adding an owner check
  // to a worker write would only invent a way for the worker to fail.

  /** The last seq written for a task — how TaskTrace is seeded when a run resumes. */
  async lastEventSeq(taskId: string): Promise<number> {
    const res = await this.pg.query<{ m: string }>(
      `SELECT COALESCE(MAX(seq), 0) AS m FROM lex_task_events WHERE task_id = $1`,
      [taskId]
    );
    return Number(res.rows[0].m);
  }

  /**
   * Persists a batch of trace events in ONE statement. `ON CONFLICT DO NOTHING` makes an append
   * idempotent, so a reclaimed run that re-emits a seq it already wrote is a no-op rather than a
   * unique-violation that would kill the whole run.
   *
   * Sanitised here because this is the last gate before the text hits a `text` column: a single
   * NUL byte echoed back by the model would abort the INSERT and lose the rest of a ten-minute
   * run (the same failure that killed documents mid-ingest before sanitizeForStorage existed).
   */
  async appendEvents(
    taskId: string,
    events: PendingTaskEvent[]
  ): Promise<void> {
    if (events.length === 0) return;
    const params: unknown[] = [taskId];
    const tuples = events.map((e) => {
      params.push(e.seq, e.kind, sanitizeForStorage(e.message));
      return `($1, $${params.length - 2}, $${params.length - 1}, $${params.length})`;
    });
    await this.pg.query(
      `INSERT INTO lex_task_events (task_id, seq, kind, message)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (task_id, seq) DO NOTHING`,
      params
    );
  }

  /**
   * Reports progress AND heartbeats the claim. Refreshing `locked_at` on every step is what lets
   * the stale-lock timeout stay short: a task that is genuinely working keeps proving it, so only
   * a task whose process actually died goes stale.
   */
  async updateProgress(
    taskId: string,
    progress: { done: number; total: number; step: string }
  ): Promise<void> {
    await this.pg.query(
      `UPDATE lex_tasks
         SET progress_done = $2, progress_total = $3, step = $4,
             locked_at = now(), updated_at = now()
       WHERE id = $1`,
      [taskId, progress.done, progress.total, progress.step]
    );
  }

  /**
   * Records a terminal outcome and releases the claim.
   *
   * The `status IN ('running', $2)` guard is the cancellation race: if the user cancelled while
   * the synthesis was in flight, the row is already 'cancelled' and a late 'done' must NOT
   * resurrect it. Writing the same status twice stays idempotent.
   */
  async finish(taskId: string, outcome: TaskOutcome): Promise<void> {
    await this.pg.query(
      `UPDATE lex_tasks
         SET status = $2,
             result_message_id = COALESCE($3, result_message_id),
             error = $4,
             step = NULL,
             locked_at = NULL,
             updated_at = now()
       WHERE id = $1 AND status IN ('running', $2)`,
      [
        taskId,
        outcome.status,
        outcome.resultMessageId ?? null,
        outcome.error ? sanitizeForStorage(outcome.error).slice(0, 2000) : null
      ]
    );
  }

  /** Current status, or null if the row is gone — the runner's cancellation check. */
  async statusOf(taskId: string): Promise<LexTaskStatus | null> {
    const res = await this.pg.query<{ status: LexTaskStatus }>(
      `SELECT status FROM lex_tasks WHERE id = $1`,
      [taskId]
    );
    return res.rows[0]?.status ?? null;
  }
}
