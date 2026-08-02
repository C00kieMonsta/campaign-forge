// Document generation becomes a background task, like the assessments.
//
// It used to be one synchronous HTTP request that did everything inline: retrieve the pack, draft
// the claims, then verify every claim with its own frontier-model call, sequentially. Three things
// were wrong with that, and all three bit in production:
//
//   1. Nothing was persisted until the final transaction, so a failure at claim 28 of 30 threw away
//      the whole run — minutes of frontier-model calls with nothing to show and nothing to inspect.
//   2. Closing the tab killed it, and left no record that it had ever been attempted.
//   3. The request outlived nginx. `/api/admin/lex/artifacts/generate` falls through to the
//      catch-all location, which uses nginx's DEFAULT 60s read timeout — the 600s override applies
//      only to campaign send and the chat SSE stream. Past a minute nginx returns its own 504,
//      which carries no CORS header, so the browser reported it as a CORS policy failure and the
//      real cause was invisible.
//
// Two columns carry it:
//
//   params            the generation request (type, documentIds, sourceMode). `title` and
//                     `instructions` already have columns and keep them; the rest is kind-specific,
//                     and a JSONB column beats three nullable ones that only one kind ever fills.
//   result_artifact_id  what the run produced, so the finished task offers the document directly
//                     rather than making the user go and find it.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_tasks
      ADD COLUMN params JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN result_artifact_id UUID REFERENCES lex_artifacts(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_tasks
      DROP COLUMN IF EXISTS result_artifact_id,
      DROP COLUMN IF EXISTS params;
  `);
};
