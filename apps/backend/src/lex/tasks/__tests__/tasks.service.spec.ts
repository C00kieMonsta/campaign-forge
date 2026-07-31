import { BadRequestException } from "@nestjs/common";
import type { PgService } from "../../../shared/pg.service";
import type { ConversationsService } from "../../conversations/conversations.service";
import type { WorkspacesService } from "../../workspaces/workspaces.service";
import { TasksService } from "../tasks.service";

/**
 * The queue's SQL is hand-built (a multi-row INSERT with computed parameter positions) and its
 * ownership rules decide where a court-filed answer lands. Neither is visible to tsc, so both are
 * asserted here against a stubbed PgService.
 */

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "task-1",
  workspace_id: "ws-1",
  owner_email: "lawyer@example.com",
  conversation_id: "conv-1",
  kind: "assess_documents",
  title: "Assess prescription",
  instructions: null,
  status: "queued",
  progress_done: 0,
  progress_total: 0,
  step: null,
  result_message_id: null,
  error: null,
  created_at: new Date("2026-07-30T10:00:00Z"),
  updated_at: new Date("2026-07-30T10:00:00Z"),
  ...over
});

describe("TasksService", () => {
  let pg: { query: jest.Mock; withTransaction: jest.Mock };
  let workspaces: { getOrFail: jest.Mock };
  let conversations: { getOrFail: jest.Mock; create: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    pg = { query: jest.fn(), withTransaction: jest.fn() };
    workspaces = { getOrFail: jest.fn().mockResolvedValue({ id: "ws-1" }) };
    conversations = {
      getOrFail: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: "conv-new" })
    };
    service = new TasksService(
      pg as unknown as PgService,
      workspaces as unknown as WorkspacesService,
      conversations as unknown as ConversationsService
    );
  });

  describe("create", () => {
    it("creates a conversation when none was given, so the answer has somewhere to land", async () => {
      pg.query.mockResolvedValue({
        rows: [taskRow({ conversation_id: "conv-new" })]
      });

      const task = await service.create("lawyer@example.com", {
        workspaceId: "ws-1",
        kind: "assess_documents",
        title: "Assess prescription"
      });

      expect(conversations.create).toHaveBeenCalledWith(
        "lawyer@example.com",
        "ws-1",
        { title: "Assess prescription" }
      );
      expect(pg.query.mock.calls[0][1]).toContain("conv-new");
      expect(task.conversationId).toBe("conv-new");
      expect(task.status).toBe("queued");
    });

    it("rejects a conversation from another workspace", async () => {
      // Otherwise the assessment of case A is filed into the thread of case B.
      conversations.getOrFail.mockResolvedValue({
        id: "conv-2",
        workspaceId: "ws-OTHER"
      });

      await expect(
        service.create("lawyer@example.com", {
          workspaceId: "ws-1",
          conversationId: "conv-2",
          kind: "assess_documents",
          title: "Assess prescription"
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pg.query).not.toHaveBeenCalled();
    });

    it("checks workspace ownership before writing anything", async () => {
      workspaces.getOrFail.mockRejectedValue(new Error("Workspace not found"));

      await expect(
        service.create("intruder@example.com", {
          workspaceId: "ws-1",
          kind: "assess_documents",
          title: "Assess prescription"
        })
      ).rejects.toThrow("Workspace not found");
      expect(pg.query).not.toHaveBeenCalled();
    });
  });

  describe("appendEvents", () => {
    it("writes a batch in ONE statement with correctly positioned parameters", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      await service.appendEvents("task-1", [
        { seq: 1, kind: "reasoning", message: "reading the summons" },
        { seq: 2, kind: "finding", message: "served late" }
      ]);

      expect(pg.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pg.query.mock.calls[0];
      expect(sql).toContain("($1, $2, $3, $4), ($1, $5, $6, $7)");
      expect(sql).toContain("ON CONFLICT (task_id, seq) DO NOTHING");
      expect(params).toEqual([
        "task-1",
        1,
        "reasoning",
        "reading the summons",
        2,
        "finding",
        "served late"
      ]);
    });

    it("does not touch the database for an empty batch", async () => {
      await service.appendEvents("task-1", []);
      expect(pg.query).not.toHaveBeenCalled();
    });

    it("strips the control characters that would abort the INSERT mid-run", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      await service.appendEvents("task-1", [
        { seq: 1, kind: "reasoning", message: "art.\u00002277 C.civ.\nsuite" }
      ]);

      const params = pg.query.mock.calls[0][1];
      expect(params[3]).toBe("art.2277 C.civ.\nsuite"); // NUL gone, newline kept
    });
  });

  describe("cancel", () => {
    it("cancels a queued task", async () => {
      pg.query.mockResolvedValue({ rows: [taskRow({ status: "cancelled" })] });

      const task = await service.cancel("lawyer@example.com", "task-1");

      expect(task.status).toBe("cancelled");
      expect(pg.query.mock.calls[0][0]).toContain(
        "status IN ('queued', 'running')"
      );
    });

    it("reports 400, not 404, for a task that already finished", async () => {
      pg.query
        .mockResolvedValueOnce({ rows: [] }) // the guarded UPDATE matched nothing
        .mockResolvedValueOnce({ rows: [taskRow({ status: "done" })] }); // ...but it exists

      await expect(
        service.cancel("lawyer@example.com", "task-1")
      ).rejects.toThrow(/already done/);
    });
  });

  describe("events", () => {
    it("returns the trace after the cursor, with the bigint id mapped to a number", async () => {
      pg.query
        .mockResolvedValueOnce({ rows: [taskRow({ status: "running" })] }) // ownership
        .mockResolvedValueOnce({
          rows: [
            {
              id: "9007199254740", // int8 arrives as a string
              task_id: "task-1",
              seq: 12,
              kind: "finding",
              message: "served late",
              created_at: new Date("2026-07-30T10:05:00Z")
            }
          ]
        });

      const events = await service.events("lawyer@example.com", "task-1", 11);

      expect(pg.query.mock.calls[1][1]).toEqual(["task-1", 11, 2000]);
      expect(events).toEqual([
        {
          id: 9007199254740,
          taskId: "task-1",
          seq: 12,
          kind: "finding",
          message: "served late",
          createdAt: "2026-07-30T10:05:00.000Z"
        }
      ]);
    });
  });

  describe("finish", () => {
    it("cannot resurrect a task the user cancelled mid-run", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      await service.finish("task-1", {
        status: "done",
        resultMessageId: "msg-1"
      });

      const [sql, params] = pg.query.mock.calls[0];
      // 'cancelled' matches neither 'running' nor $2='done', so the row stays cancelled.
      expect(sql).toContain("WHERE id = $1 AND status IN ('running', $2)");
      expect(params).toEqual(["task-1", "done", "msg-1", null]);
    });
  });

  describe("updateProgress", () => {
    it("heartbeats locked_at so a working task is never reclaimed as dead", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      await service.updateProgress("task-1", {
        done: 12,
        total: 47,
        step: "reading Dagvaarding.pdf (12/47)"
      });

      expect(pg.query.mock.calls[0][0]).toContain("locked_at = now()");
      expect(pg.query.mock.calls[0][1]).toEqual([
        "task-1",
        12,
        47,
        "reading Dagvaarding.pdf (12/47)"
      ]);
    });
  });
});
