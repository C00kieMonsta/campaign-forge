// A message records WHAT PRODUCED IT, so the context assembler can stop evicting the expensive ones.
//
// A background assessment reads every pièce in the case file, costs minutes and real money, and
// posts its answer into the conversation as an ordinary assistant row. Nothing about that row said
// where it came from — it was indistinguishable from a two-line chat reply. So the assembler's
// turn budget treated it as ordinary history and dropped it oldest-first like anything else, which
// is precisely backwards: a practitioner refers back to "the suggestion the deep read made" for
// the rest of the thread, and by then the model could no longer see it.
//
// NULLABLE, and null means "ordinary chat turn". Three values are written today:
//
//   'assessment' — assess_documents / adverse_case, on BOTH rows the runner writes (the synthetic
//                  user turn carrying the question, and the assistant turn carrying the answer).
//                  The pair is protected together because the answer without its question is an
//                  unattributed wall of findings.
//   'artifact'   — generate_artifact's announcement rows. Recorded but NOT protected: the artifact
//                  itself lives in its own table and the message is a pointer to it, so there is
//                  nothing here worth spending a context budget on. It is distinguished from
//                  'assessment' precisely so a later change cannot pin both by accident.
//
// The backfill is best-effort and known to be incomplete. lex_tasks.result_message_id is the only
// existing link, it is ON DELETE SET NULL, and it only ever recorded the assistant row — so the
// synthetic user turns and any message whose task row is gone stay null. That is the right
// failure: an un-backfilled row is treated as ordinary history, which is exactly how it behaved
// before this column existed.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_messages
      ADD COLUMN IF NOT EXISTS origin TEXT;

    -- Best-effort backfill for assistant rows a task still points at.
    UPDATE lex_messages m
       SET origin = CASE
             WHEN t.kind IN ('assess_documents', 'adverse_case') THEN 'assessment'
             WHEN t.kind = 'generate_artifact' THEN 'artifact'
           END
      FROM lex_tasks t
     WHERE t.result_message_id = m.id
       AND m.origin IS NULL
       AND t.kind IN ('assess_documents', 'adverse_case', 'generate_artifact');

    -- Read per conversation while assembling a turn, always alongside the seq ordering the
    -- assembler already pages by. Partial, because the overwhelming majority of rows are null.
    CREATE INDEX IF NOT EXISTS idx_lex_messages_origin
      ON lex_messages (conversation_id, seq)
      WHERE origin IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_lex_messages_origin;
    ALTER TABLE lex_messages DROP COLUMN IF EXISTS origin;
  `);
};
