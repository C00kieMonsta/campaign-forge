// Phase 4: mandatory human sign-off + machine verification report on artifact versions.
// "verified" is a machine gate (judge + verbatim backstop); a human must still sign off
// before a version can be exported for filing.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_artifact_versions
      ADD COLUMN IF NOT EXISTS signed_off_at       TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signed_off_by       TEXT,
      ADD COLUMN IF NOT EXISTS verification_report  JSONB;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_artifact_versions
      DROP COLUMN IF EXISTS signed_off_at,
      DROP COLUMN IF EXISTS signed_off_by,
      DROP COLUMN IF EXISTS verification_report;
  `);
};
