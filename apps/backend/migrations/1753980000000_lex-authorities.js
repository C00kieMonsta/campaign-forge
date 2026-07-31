// Authorities: law the user uploads (a code, a statute, a leading judgment) that Lex must treat
// as non-negotiable truth and consult on every turn. Distinct from lex_artifacts, which is
// GENERATED output.
//
// OWNER-scoped, not workspace-scoped: Belgian family law applies to every case this user has, so
// scoping it per workspace would mean re-uploading a 700-page code once per matter.
//
// WHY A SEPARATE CHUNK TABLE rather than a nullable authority_id on lex_document_chunks: every
// document-retrieval query is hard-scoped by `c.workspace_id = $1 AND c.owner_email = $2 AND
// d.lifecycle_state = 'active'`. Making authorities share that table would turn each of those
// scope clauses into a conditional and put a workspace-leak one mistake away, on the query path
// whose correctness citations depend on. A separate table leaves the proven document path exactly
// as it is and makes authority retrieval purely additive. The cost is a second HNSW index.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE lex_authorities (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_email    TEXT NOT NULL REFERENCES lex_users(email),
      title          TEXT NOT NULL,
      filename       TEXT NOT NULL,
      content_type   TEXT,
      size_bytes     BIGINT,
      s3_key         TEXT NOT NULL,
      s3_version_id  TEXT,
      sha256         TEXT,
      status         TEXT NOT NULL DEFAULT 'awaiting_upload',
        -- awaiting_upload | uploaded | parsing | chunking | embedding | digesting | ready | failed
      language       TEXT,
      page_count     INT,
      article_count  INT NOT NULL DEFAULT 0,
      -- The compressed, article-numbered index injected into every chat turn.
      digest         TEXT,
      digest_tokens  INT,
      -- False keeps the authority stored and searchable but out of every prompt.
      enabled        BOOLEAN NOT NULL DEFAULT true,
      error          TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_authorities_owner ON lex_authorities (owner_email, created_at DESC);
    CREATE INDEX idx_lex_authorities_enabled ON lex_authorities (owner_email, enabled);

    CREATE TABLE lex_authority_chunks (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      authority_id  UUID NOT NULL REFERENCES lex_authorities(id) ON DELETE CASCADE,
      owner_email   TEXT NOT NULL,
      chunk_index   INT NOT NULL,
      -- The article this chunk belongs to ("Art. 374"). This is what a legal citation points at:
      -- an article number is stable across editions and printings in a way a page number is not.
      article_label TEXT,
      page_from     INT,
      page_to       INT,
      char_start    INT,
      char_end      INT,
      content       TEXT NOT NULL,
      token_count   INT,
      embedding     halfvec(3072),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_authority_chunks_authority
      ON lex_authority_chunks (authority_id, chunk_index);
    CREATE INDEX idx_lex_authority_chunks_article
      ON lex_authority_chunks (owner_email, article_label);
    CREATE INDEX idx_lex_authority_chunks_embedding
      ON lex_authority_chunks USING hnsw (embedding halfvec_cosine_ops);
    CREATE INDEX idx_lex_authority_chunks_fts ON lex_authority_chunks USING gin (
      (to_tsvector('french', content) || to_tsvector('dutch', content))
    );

    -- Ingestion queue for authorities. Separate from lex_ingestion_jobs, whose document_id has a
    -- NOT NULL FK to lex_documents.
    CREATE TABLE lex_authority_jobs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      authority_id  UUID NOT NULL REFERENCES lex_authorities(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
      attempts      INT NOT NULL DEFAULT 0,
      last_error    TEXT,
      locked_at     TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_lex_authority_jobs_status ON lex_authority_jobs (status, created_at);

    -- A claim can now cite law as well as a case document. Nullable and additive, so every
    -- existing citation row and query stays valid.
    ALTER TABLE lex_citations
      ADD COLUMN IF NOT EXISTS authority_chunk_id UUID
        REFERENCES lex_authority_chunks(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS authority_id UUID
        REFERENCES lex_authorities(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS article_label TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_citations
      DROP COLUMN IF EXISTS article_label,
      DROP COLUMN IF EXISTS authority_id,
      DROP COLUMN IF EXISTS authority_chunk_id;
    DROP TABLE IF EXISTS lex_authority_jobs;
    DROP TABLE IF EXISTS lex_authority_chunks;
    DROP TABLE IF EXISTS lex_authorities;
  `);
};
