/* eslint-disable @typescript-eslint/no-var-requires */
// Lex initial schema — PostgreSQL (RDS) + pgvector.
//
// Run FROM the backend EC2 (RDS is VPC-private, not publicly reachable):
//   cd /home/ec2-user/campaign-forge && set -a && . apps/backend/.env && set +a \
//     && pnpm --filter @apps/backend migrate
//
// Requires pgvector >= 0.7.0 for `halfvec` (text-embedding-3-large is 3072 dims, and
// pgvector's HNSW index cannot index the plain `vector` type above 2000 dims). RDS PG16
// ships a compatible pgvector.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS vector;

    -- ── Identity (single-tenant now, multi-user-ready) ─────────────────────────────
    CREATE TABLE lex_users (
      email         TEXT PRIMARY KEY,
      display_name  TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── Workspaces (one per court case/topic, long-lived) ──────────────────────────
    CREATE TABLE lex_workspaces (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_email  TEXT NOT NULL REFERENCES lex_users(email),
      name         TEXT NOT NULL,
      description  TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_workspaces_owner ON lex_workspaces (owner_email, updated_at DESC);

    -- ── Documents (S3-backed; timeline + lifecycle + parse state machine) ──────────
    CREATE TABLE lex_documents (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      owner_email     TEXT NOT NULL REFERENCES lex_users(email),
      filename        TEXT NOT NULL,
      content_type    TEXT,
      size_bytes      BIGINT,
      s3_key          TEXT NOT NULL,
      s3_version_id   TEXT,
      sha256          TEXT NOT NULL,
      parse_status    TEXT NOT NULL DEFAULT 'uploaded',
        -- uploaded | parsing | chunking | embedding | summarizing | ready | failed | needs_ocr
      lifecycle_state TEXT NOT NULL DEFAULT 'active',   -- active | superseded | archived
      timeline_date   DATE,                              -- legally-relevant date (for the timeline)
      page_count      INT,
      summary         TEXT,
      error           TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, sha256)                      -- content-addressed dedupe
    );
    CREATE INDEX idx_lex_documents_workspace_date ON lex_documents (workspace_id, timeline_date);
    CREATE INDEX idx_lex_documents_status ON lex_documents (parse_status);

    -- ── Chunks (embeddings + citation anchors) ─────────────────────────────────────
    CREATE TABLE lex_document_chunks (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id  UUID NOT NULL REFERENCES lex_documents(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      owner_email  TEXT NOT NULL,
      chunk_index  INT NOT NULL,
      page_from    INT,
      page_to      INT,
      char_start   INT,          -- offsets into the document text — the citation anchor
      char_end     INT,
      content      TEXT NOT NULL,
      token_count  INT,
      embedding    halfvec(3072),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_chunks_doc ON lex_document_chunks (document_id, chunk_index);
    CREATE INDEX idx_lex_chunks_workspace ON lex_document_chunks (workspace_id);
    -- ANN index for vector search (cosine matches OpenAI's normalized embeddings).
    CREATE INDEX idx_lex_chunks_embedding
      ON lex_document_chunks USING hnsw (embedding halfvec_cosine_ops);
    -- Hybrid full-text search over FR + NL. Expression index (not a generated column) to
    -- avoid the to_tsvector-immutability friction; retrieval must use the SAME expression.
    CREATE INDEX idx_lex_chunks_fts ON lex_document_chunks USING gin (
      (to_tsvector('french', content) || to_tsvector('dutch', content))
    );

    -- ── Ingestion jobs (in-process worker; SELECT ... FOR UPDATE SKIP LOCKED) ───────
    CREATE TABLE lex_ingestion_jobs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id  UUID NOT NULL REFERENCES lex_documents(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
      attempts     INT NOT NULL DEFAULT 0,
      last_error   TEXT,
      locked_at    TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_jobs_status ON lex_ingestion_jobs (status, created_at);

    -- ── Conversations + messages (persist forever, survive the context window) ─────
    CREATE TABLE lex_conversations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      owner_email  TEXT NOT NULL,
      title        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_conversations_workspace ON lex_conversations (workspace_id, updated_at DESC);

    CREATE TABLE lex_messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES lex_conversations(id) ON DELETE CASCADE,
      owner_email     TEXT NOT NULL,
      seq             BIGINT NOT NULL,                  -- monotonic order within a conversation
      role            TEXT NOT NULL,                    -- user | assistant | system
      content         TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'complete', -- pending | complete | failed
      token_count     INT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (conversation_id, seq)
    );
    CREATE INDEX idx_lex_messages_conv ON lex_messages (conversation_id, seq);

    -- Rolling compression checkpoints (hierarchical summaries).
    CREATE TABLE lex_conversation_summaries (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id     UUID NOT NULL REFERENCES lex_conversations(id) ON DELETE CASCADE,
      through_message_seq BIGINT NOT NULL,
      level               INT NOT NULL DEFAULT 1,
      summary             TEXT NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_conv_summaries
      ON lex_conversation_summaries (conversation_id, through_message_seq DESC);

    -- Workspace-level durable "state of the case" memory.
    CREATE TABLE lex_case_state (
      workspace_id UUID PRIMARY KEY REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      case_memory  JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary      TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── Artifacts (court documents) + immutable versions ───────────────────────────
    CREATE TABLE lex_artifacts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      conversation_id UUID REFERENCES lex_conversations(id) ON DELETE SET NULL,
      owner_email     TEXT NOT NULL,
      type            TEXT NOT NULL,                    -- memo | chronology | submission
      title           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft',    -- draft | verified | final | filed
      current_version INT NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_artifacts_workspace ON lex_artifacts (workspace_id, updated_at DESC);

    CREATE TABLE lex_artifact_versions (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_id         UUID NOT NULL REFERENCES lex_artifacts(id) ON DELETE CASCADE,
      version             INT NOT NULL,
      body_json           JSONB NOT NULL,               -- ProseMirror document
      verification_status TEXT NOT NULL DEFAULT 'unverified', -- unverified | verified | failed
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (artifact_id, version)
    );

    -- ── Citations (the trust backbone) ─────────────────────────────────────────────
    -- A citation links a claim (in a message OR an artifact version) to an exact source
    -- chunk span. Offsets/page/hash are copied here so a rendered artifact stays
    -- verifiable even if chunking is later recomputed.
    CREATE TABLE lex_citations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_email         TEXT NOT NULL,
      message_id          UUID REFERENCES lex_messages(id) ON DELETE CASCADE,
      artifact_version_id UUID REFERENCES lex_artifact_versions(id) ON DELETE CASCADE,
      claim_id            TEXT,                          -- ProseMirror mark id (artifact claims)
      chunk_id            UUID REFERENCES lex_document_chunks(id) ON DELETE SET NULL,
      document_id         UUID REFERENCES lex_documents(id) ON DELETE SET NULL,
      quote               TEXT,
      page_from           INT,
      page_to             INT,
      char_start          INT,
      char_end            INT,
      chunk_content_hash  TEXT,                          -- staleness detection
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- exactly one source
      CHECK ((message_id IS NOT NULL) <> (artifact_version_id IS NOT NULL))
    );
    CREATE INDEX idx_lex_citations_message ON lex_citations (message_id);
    CREATE INDEX idx_lex_citations_artifact_version ON lex_citations (artifact_version_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS lex_citations;
    DROP TABLE IF EXISTS lex_artifact_versions;
    DROP TABLE IF EXISTS lex_artifacts;
    DROP TABLE IF EXISTS lex_case_state;
    DROP TABLE IF EXISTS lex_conversation_summaries;
    DROP TABLE IF EXISTS lex_messages;
    DROP TABLE IF EXISTS lex_conversations;
    DROP TABLE IF EXISTS lex_ingestion_jobs;
    DROP TABLE IF EXISTS lex_document_chunks;
    DROP TABLE IF EXISTS lex_documents;
    DROP TABLE IF EXISTS lex_workspaces;
    DROP TABLE IF EXISTS lex_users;
    -- Leave the pgvector extension in place; dropping it is intentionally omitted.
  `);
};
