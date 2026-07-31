// A durable per-page index, built ONCE at ingestion, so a prompt spanning the whole case file
// never re-reads or re-summarises the documents.
//
// The table deliberately holds TWO GRAINS at different trust levels, and the distinction is the
// whole safety argument:
//
//   EXACT      ordinal, page_number, char_start/char_end, text, continues_into_next, fingerprint.
//              Derived with no model, round-trip asserted against the same fullText the chunks are
//              offset against. This grain is CITABLE.
//   GENERATED  description, facts, dates, names, refs, page_kind.
//              Decides WHAT TO READ. Never the string a citation is verified against — a citation
//              must resolve to source text, and a description is a paraphrase.
//
// What is NOT here, on purpose: page embeddings and a second halfvec HNSW index (at this corpus
// size every page's routing line fits in one prompt, so ANN buys nothing and costs a second
// resident index on a 4 GB box), and any node/edge tables for cross-document references. Typed
// GIN-indexed arrays answer the same questions — "the chronology", "which pages cite art. 374",
// "every page naming X" — with no resolution state machine and no invalidation surface, because
// everything cascades from document_id.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE lex_document_pages (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id   UUID NOT NULL REFERENCES lex_documents(id)  ON DELETE CASCADE,
      workspace_id  UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      owner_email   TEXT NOT NULL,

      -- 1-based reading order: the addressing and packing key. page_number is the REAL page and
      -- is NULL when the format has no pages (a .docx or an email yields one text blob, which we
      -- sub-divide into sections rather than inventing page numbers that would then be cited).
      ordinal       INT  NOT NULL,
      page_number   INT,
      page_label    TEXT NOT NULL,          -- 'p. 7' | 'sheet: Facturen' | '§3' | 'whole document'
      page_origin   TEXT NOT NULL DEFAULT 'page'
        CHECK (page_origin IN ('page', 'sheet', 'section', 'approximate')),

      -- Offsets into the reconstructed fullText — this IS the pageRanges that buildFullText
      -- already computes and today discards.
      char_start    INT  NOT NULL,
      char_end      INT  NOT NULL,
      text          TEXT NOT NULL,
      char_count    INT  NOT NULL,
      token_count   INT,

      -- sha256 of the normalised text. The same annex appears in three bundles in a real court
      -- file; the document-level duplicate check cannot see it, because the documents differ.
      text_fingerprint TEXT,
      -- Deterministic, no model: a clause split across pp. 6-7 must never be read half.
      continues_into_next BOOLEAN NOT NULL DEFAULT FALSE,

      -- ── generated grain (populated later; never citable) ──────────────────────────────
      page_kind     TEXT,                   -- prose|table|form|signature|blank|illegible|mixed
      description   TEXT,
      facts         JSONB NOT NULL DEFAULT '{}'::jsonb,
      dates         DATE[] NOT NULL DEFAULT '{}',
      names         TEXT[] NOT NULL DEFAULT '{}',
      refs          TEXT[] NOT NULL DEFAULT '{}',   -- normalised: 'piece:12','annexe:B','art:374'
      -- FALSE when describing failed, was skipped, or its verbatim spans did not match the page.
      -- An untrusted page is ALWAYS read verbatim: a drifting describer must cost money, never
      -- coverage.
      description_trusted BOOLEAN NOT NULL DEFAULT FALSE,
      described_by  TEXT,
      index_version INT NOT NULL DEFAULT 0,

      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (document_id, ordinal),
      CHECK (char_end >= char_start)
    );

    CREATE INDEX idx_lex_pages_doc   ON lex_document_pages (document_id, ordinal);
    CREATE INDEX idx_lex_pages_scope ON lex_document_pages (workspace_id, owner_email);
    -- FTS over the DESCRIPTION only. lex_document_chunks already carries a FR+NL GIN over the
    -- same words; duplicating it would double the largest index in the database for nothing.
    CREATE INDEX idx_lex_pages_desc_fts ON lex_document_pages USING gin (
      (to_tsvector('french', coalesce(description, '')) ||
       to_tsvector('dutch',  coalesce(description, '')))
    );
    -- The deterministic floor under any model-driven routing, and a zero-model-call chronology.
    CREATE INDEX idx_lex_pages_dates ON lex_document_pages USING gin (dates);
    CREATE INDEX idx_lex_pages_names ON lex_document_pages USING gin (names);
    CREATE INDEX idx_lex_pages_refs  ON lex_document_pages USING gin (refs);
    CREATE INDEX idx_lex_pages_fingerprint ON lex_document_pages (workspace_id, text_fingerprint)
      WHERE text_fingerprint IS NOT NULL;

    -- Additive and nullable, so every existing citation row stays exactly as valid as it was.
    -- chunk_content_hash keeps its meaning; page anchors get their own staleness detector.
    ALTER TABLE lex_citations
      ADD COLUMN IF NOT EXISTS page_id        UUID
        REFERENCES lex_document_pages(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS page_ordinal   INT,
      ADD COLUMN IF NOT EXISTS page_text_hash TEXT;

    ALTER TABLE lex_documents
      ADD COLUMN IF NOT EXISTS page_index_version INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS page_index_error   TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_documents
      DROP COLUMN IF EXISTS page_index_error,
      DROP COLUMN IF EXISTS page_index_version;
    ALTER TABLE lex_citations
      DROP COLUMN IF EXISTS page_text_hash,
      DROP COLUMN IF EXISTS page_ordinal,
      DROP COLUMN IF EXISTS page_id;
    DROP TABLE IF EXISTS lex_document_pages;
  `);
};
