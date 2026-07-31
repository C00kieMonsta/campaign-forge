// Long-running reasoning tasks: "assess all 47 documents for X", which cannot fit one context
// window and takes minutes. They run in the BACKGROUND so the lawyer can close the tab.
//
// The trace is persisted rather than only streamed, because background execution is the whole
// point: a task started before lunch must still be readable afterwards, and a reconnecting client
// must be able to replay what it missed. Events are written in BATCHES (a flush per step or per
// few hundred characters of reasoning) — one row per token would be tens of thousands of inserts
// for a single run and would make the events table the bottleneck.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE lex_tasks (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id      UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      owner_email       TEXT NOT NULL,
      -- The conversation the finished answer is posted into, so the result lands where the
      -- lawyer is already reading rather than in a separate silo.
      conversation_id   UUID REFERENCES lex_conversations(id) ON DELETE SET NULL,
      kind              TEXT NOT NULL DEFAULT 'assess_documents',
      title             TEXT NOT NULL,
      instructions      TEXT,
      status            TEXT NOT NULL DEFAULT 'queued',
        -- queued | running | done | failed | cancelled
      progress_done     INT NOT NULL DEFAULT 0,
      progress_total    INT NOT NULL DEFAULT 0,
      step              TEXT,
      result_message_id UUID REFERENCES lex_messages(id) ON DELETE SET NULL,
      error             TEXT,
      attempts          INT NOT NULL DEFAULT 0,
      -- Claim timestamp. A task whose worker died is reclaimed once this goes stale, so a crash
      -- mid-run cannot leave a task 'running' forever.
      locked_at         TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT lex_tasks_status_check
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled'))
    );
    CREATE INDEX idx_lex_tasks_workspace ON lex_tasks (workspace_id, created_at DESC);
    CREATE INDEX idx_lex_tasks_status ON lex_tasks (status, created_at);

    CREATE TABLE lex_task_events (
      id         BIGSERIAL PRIMARY KEY,
      task_id    UUID NOT NULL REFERENCES lex_tasks(id) ON DELETE CASCADE,
      -- Per-task monotonic sequence: the cursor a reconnecting client resumes from.
      seq        INT NOT NULL,
      kind       TEXT NOT NULL,   -- reasoning | progress | finding | error | done
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (task_id, seq)
    );
    CREATE INDEX idx_lex_task_events_task ON lex_task_events (task_id, seq);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS lex_task_events;
    DROP TABLE IF EXISTS lex_tasks;
  `);
};
