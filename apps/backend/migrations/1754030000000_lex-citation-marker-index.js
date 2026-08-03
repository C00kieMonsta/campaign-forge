// A citation records WHICH MARKER it belongs to, so a reference can be traced back.
//
// The assistant cites inline as [1], [2], … and those numbers are positions in the ephemeral
// SOURCES/FINDINGS list assembled for that one call. The list is gone the moment the run ends, and
// the citation rows did not record the number — so nothing downstream could say which row [397]
// referred to. In the UI that surfaced as the worst possible outcome for a legal tool: the answer
// was full of bracketed numbers that pointed at nothing a reader could open, and a filed document
// whose references cannot be traced is not a filed document.
//
// It bit hardest on the background assessments, where an adverse read over 54 pièces produces
// hundreds of findings and the markers run into the [300]s. The frontend bounded markers by the
// COUNT of citations it had (a dozen), so almost every marker fell out of range and rendered as
// plain text — while the citations themselves sat in this table, unreachable.
//
// Nullable, and stays nullable: an artifact claim's citation has no marker (it is anchored to a
// claim id instead), and rows written before this column existed have no number to backfill —
// their marker list is not recoverable, so they keep rendering as plain text rather than being
// given a guessed one.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lex_citations
      ADD COLUMN IF NOT EXISTS marker_index INT;

    -- Looked up per message when a conversation page is rendered, ordered by marker.
    CREATE INDEX IF NOT EXISTS idx_lex_citations_message_marker
      ON lex_citations (message_id, marker_index);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_lex_citations_message_marker;
    ALTER TABLE lex_citations DROP COLUMN IF EXISTS marker_index;
  `);
};
