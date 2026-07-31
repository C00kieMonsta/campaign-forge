// Voice notes. An audio document is a normal lex_document whose text comes from Whisper
// instead of a text layer: the transcript is stored so it can be re-read and hand-edited, and
// the duration is kept for the UI. Saving an edited transcript must re-chunk/re-embed WITHOUT
// paying for transcription again, so the ingestion job now carries a mode.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_documents
      ADD COLUMN IF NOT EXISTS transcript       TEXT,
      ADD COLUMN IF NOT EXISTS duration_seconds INT;

    -- full    = derive text from the S3 source (parse / OCR / transcribe), then index
    -- reindex = reuse the stored transcript (hand-edited), then index
    ALTER TABLE lex_ingestion_jobs
      ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'full';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_ingestion_jobs DROP COLUMN IF EXISTS mode;
    ALTER TABLE lex_documents
      DROP COLUMN IF EXISTS transcript,
      DROP COLUMN IF EXISTS duration_seconds;
  `);
};
