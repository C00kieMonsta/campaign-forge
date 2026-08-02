// How hard a background run is allowed to think, chosen per task rather than fixed in code.
//
// Before this, both task kinds ran the same way whatever the user asked for: the per-document map
// was pinned to the cheap tier at `low` effort, and the synthesis took the default depth. There was
// no way to say "this one matters" — and on a succession file that has run for twenty years, the
// run before a hearing is not the same request as an exploratory one.
//
// Stored on the row because the runner claims tasks from the database: a depth held only in the
// request would be gone by the time the work starts.
//
// Backfilled to 'standard' rather than the new default of 'thorough'. Existing rows were created
// under the old fixed behaviour, and re-reading them at maximum effort on a retry would spend real
// money the user never asked for.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_tasks
      ADD COLUMN depth TEXT NOT NULL DEFAULT 'standard';

    ALTER TABLE lex_tasks
      ADD CONSTRAINT lex_tasks_depth_check
      CHECK (depth IN ('quick', 'standard', 'thorough'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_tasks DROP CONSTRAINT IF EXISTS lex_tasks_depth_check;
    ALTER TABLE lex_tasks DROP COLUMN IF EXISTS depth;
  `);
};
