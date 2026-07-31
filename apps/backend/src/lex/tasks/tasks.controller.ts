import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  createTaskRequestSchema,
  type LexTask,
  type LexTaskStatus,
  type LexTaskStreamEvent
} from "@packages/types";
import type { Response } from "express";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { TasksService } from "./tasks.service";

/**
 * How often the live stream looks for new trace events. Deliberately a poll and not Postgres
 * LISTEN/NOTIFY: at single-user scale two indexed lookups a second are free, and NOTIFY would
 * add a dedicated connection plus a reconnect story for no gain.
 */
const STREAM_POLL_MS = 1000;

/**
 * Resend the status frame at least this often. The map phase is one model call per document, so
 * the stream can legitimately go ~15s with nothing new to say — long enough for a proxy to decide
 * an idle connection is dead. A repeated status frame is idempotent for the client.
 */
const STATUS_HEARTBEAT_MS = 15000;

const TERMINAL: LexTaskStatus[] = ["done", "failed", "cancelled"];

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class TasksController {
  constructor(private tasks: TasksService) {}

  /** Queues a background assessment and returns immediately — the run outlives the request. */
  @Post("tasks")
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = createTaskRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const task = await this.tasks.create(user.email, parsed.data);
    return { task };
  }

  @Get("workspaces/:workspaceId/tasks")
  async list(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const items = await this.tasks.list(user.email, workspaceId);
    return { items };
  }

  @Get("tasks/:id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const task = await this.tasks.getOrFail(user.email, id);
    return { task };
  }

  @Post("tasks/:id/cancel")
  async cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const task = await this.tasks.cancel(user.email, id);
    return { task };
  }

  /** The persisted trace, for a client that would rather page it than stream it. */
  @Get("tasks/:id/events")
  async events(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("afterSeq") afterSeq?: string
  ) {
    const items = await this.tasks.events(
      user.email,
      id,
      this.parseCursor(afterSeq)
    );
    return { items };
  }

  /**
   * SSE: watch a task that is probably ALREADY RUNNING.
   *
   * Order matters and is the whole design: current status → replay every persisted event from
   * `afterSeq` → follow live → `closed`. A client that connects an hour after the task started
   * sees exactly what a client that watched from the beginning saw, which is what makes closing
   * the tab safe. `afterSeq` is the resume cursor after a dropped connection, so a reconnect
   * replays only the gap.
   */
  @Get("tasks/:id/stream")
  async stream(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Res() res: Response,
    @Query("afterSeq") afterSeqRaw?: string
  ) {
    let cursor: number;
    let task: LexTask;
    try {
      cursor = this.parseCursor(afterSeqRaw);
      task = await this.tasks.getOrFail(user.email, id);
    } catch (err) {
      // Errors are reported as HTTP here, not as SSE frames: nothing has been streamed yet, and
      // an @Res() handler has taken the response over from Nest's exception layer.
      const status = err instanceof BadRequestException ? 400 : 404;
      res.status(status).json({
        message: err instanceof Error ? err.message : "Task not found"
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: LexTaskStreamEvent): void => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const stop = (): void => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    // Without this the server keeps one interval per abandoned tab, forever.
    res.on("close", stop);

    const sendStatus = (t: LexTask): void =>
      send({
        type: "status",
        status: t.status,
        progressDone: t.progressDone,
        progressTotal: t.progressTotal,
        step: t.step ?? null
      });

    const drain = async (): Promise<void> => {
      for (const e of await this.tasks.events(user.email, id, cursor)) {
        send({ type: "event", seq: e.seq, kind: e.kind, message: e.message });
        cursor = e.seq;
      }
    };

    const finish = (): void => {
      send({ type: "closed" });
      stop();
      res.end();
    };

    sendStatus(task);
    await drain();
    if (TERMINAL.includes(task.status)) {
      finish();
      return;
    }

    let signature = this.signatureOf(task);
    let statusSentAt = Date.now();
    let polling = false;

    timer = setInterval(() => {
      // The tick is async but the interval is not: the guard stops a slow poll from overlapping
      // itself and sending the same events twice.
      if (stopped || polling) return;
      polling = true;
      void (async () => {
        try {
          // Status BEFORE events: the runner writes its final event and only then flips the
          // status, so reading status first guarantees the last event is drained before `closed`.
          const current = await this.tasks.getOrFail(user.email, id);
          await drain();

          const next = this.signatureOf(current);
          if (
            next !== signature ||
            Date.now() - statusSentAt >= STATUS_HEARTBEAT_MS
          ) {
            sendStatus(current);
            signature = next;
            statusSentAt = Date.now();
          }
          if (TERMINAL.includes(current.status)) finish();
        } catch {
          // The task was deleted, or the database blipped. Close cleanly rather than poll an
          // error every second: the client can reconnect with its cursor.
          finish();
        } finally {
          polling = false;
        }
      })();
    }, STREAM_POLL_MS);
  }

  /** Everything a status frame carries — cheap change detection, so idle streams stay quiet. */
  private signatureOf(t: LexTask): string {
    return `${t.status}|${t.progressDone}/${t.progressTotal}|${t.step ?? ""}`;
  }

  private parseCursor(raw?: string): number {
    if (raw === undefined || raw === "") return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
      throw new BadRequestException("afterSeq must be a non-negative number");
    return Math.floor(n);
  }
}
