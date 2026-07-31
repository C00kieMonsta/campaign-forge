// Two related changes to the upload pipeline.
//
// 1. DIRECT-TO-S3 UPLOAD. Bytes now go from the browser straight to S3 via a presigned PUT, so
//    they never traverse nginx (whose client_max_body_size capped uploads at 10 MB in prod) or
//    the EC2 box. The document row is therefore created BEFORE its bytes exist, so sha256 can no
//    longer be computed at insert time — it moves to the ingestion worker, which already
//    downloads the object to parse it, and the column becomes nullable.
//
// 2. DUPLICATES ARE RECORDED, NOT REFUSED. UNIQUE (workspace_id, sha256) previously made a
//    re-upload a silent no-op. The user wants duplicates surfaced and grouped, which means two
//    rows may legitimately share a hash — so the constraint becomes a plain index. A duplicate
//    points at its primary via duplicate_of and is marked lifecycle_state='superseded', which
//    the retrieval queries already filter on, so a duplicate can never be cited twice.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_documents ALTER COLUMN sha256 DROP NOT NULL;

    -- Duplicates are now stored; the hash is a lookup key, no longer a uniqueness rule.
    ALTER TABLE lex_documents DROP CONSTRAINT IF EXISTS lex_documents_workspace_id_sha256_key;
    CREATE INDEX IF NOT EXISTS idx_lex_documents_workspace_sha256
      ON lex_documents (workspace_id, sha256);

    ALTER TABLE lex_documents
      -- The primary this row duplicates. NULL means "this row is not a duplicate".
      ADD COLUMN IF NOT EXISTS duplicate_of UUID
        REFERENCES lex_documents(id) ON DELETE SET NULL,
      -- Hash of the whitespace/case-normalised extracted text: catches the same filing
      -- re-scanned or re-exported, where the bytes differ but the text does not.
      ADD COLUMN IF NOT EXISTS text_fingerprint TEXT,
      -- Where the file came from when a folder was dropped (folder path, flattened).
      ADD COLUMN IF NOT EXISTS source_path TEXT;

    CREATE INDEX IF NOT EXISTS idx_lex_documents_workspace_fingerprint
      ON lex_documents (workspace_id, text_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_lex_documents_duplicate_of
      ON lex_documents (duplicate_of);

    -- lifecycle_state was documented as active|superseded|archived in a comment only, with no
    -- constraint. Duplicate grouping now depends on 'superseded' being exactly that string.
    ALTER TABLE lex_documents DROP CONSTRAINT IF EXISTS lex_documents_lifecycle_state_check;
    ALTER TABLE lex_documents
      ADD CONSTRAINT lex_documents_lifecycle_state_check
      CHECK (lifecycle_state IN ('active', 'superseded', 'archived'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_documents DROP CONSTRAINT IF EXISTS lex_documents_lifecycle_state_check;
    DROP INDEX IF EXISTS idx_lex_documents_duplicate_of;
    DROP INDEX IF EXISTS idx_lex_documents_workspace_fingerprint;
    ALTER TABLE lex_documents
      DROP COLUMN IF EXISTS source_path,
      DROP COLUMN IF EXISTS text_fingerprint,
      DROP COLUMN IF EXISTS duplicate_of;
    DROP INDEX IF EXISTS idx_lex_documents_workspace_sha256;
    -- Restoring the UNIQUE constraint can fail if duplicates were recorded while it was absent.
    ALTER TABLE lex_documents ADD CONSTRAINT lex_documents_workspace_id_sha256_key
      UNIQUE (workspace_id, sha256);
  `);
};
