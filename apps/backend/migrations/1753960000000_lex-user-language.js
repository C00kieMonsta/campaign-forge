// One pinned language per user. It drives BOTH the admin UI and — enforced server-side — the
// language the assistant answers in, the rolling conversation summaries, the generated drafts,
// and the per-document summaries. Before this, the chat prompt said "reply in the user's
// language (French or Dutch)", which let replies drift between French and English.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_users
      ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'fr';

    ALTER TABLE lex_users
      DROP CONSTRAINT IF EXISTS lex_users_language_check;
    ALTER TABLE lex_users
      ADD CONSTRAINT lex_users_language_check CHECK (language IN ('fr', 'nl'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_users DROP CONSTRAINT IF EXISTS lex_users_language_check;
    ALTER TABLE lex_users DROP COLUMN IF EXISTS language;
  `);
};
