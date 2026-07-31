// Per-document search metadata: language (of the summary), extracted key names, and tags.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_documents
      ADD COLUMN IF NOT EXISTS language   TEXT,
      ADD COLUMN IF NOT EXISTS key_names  JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS tags       JSONB NOT NULL DEFAULT '[]'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_lex_documents_tags ON lex_documents USING gin (tags);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_lex_documents_tags;
    ALTER TABLE lex_documents
      DROP COLUMN IF EXISTS language,
      DROP COLUMN IF EXISTS key_names,
      DROP COLUMN IF EXISTS tags;
  `);
};
