// Choosing which of a question's words are worth searching for.
//
// THE PROBLEM THIS SOLVES. Postgres full-text search has no notion of term rarity. plainto_tsquery
// conjoins every token, so a natural question matches only a chunk containing all of its words and
// therefore usually matches nothing; disjoining every token instead lets the common words dominate,
// because ts_rank counts occurrences and cannot tell "pièces" from "01.01.1976". Both were measured
// on a real corpus and both lose: 17/30 and 13/30 on the retrieval evaluation.
//
// What a lexical index is FOR is the rare token — the date, the docket number, the proper noun that
// an embedding cannot place. So the query is pruned to its discriminating terms and those are
// disjoined. On the question "Que disent les pièces au sujet du 01.01.1976 ?" the corpus frequencies
// are le=1351, piec=222, sujet=64, 01.01.1976=3, disent=2, and only the last two carry any signal.
//
// This is inverse document frequency used as a FILTER rather than as a ranking weight, which is the
// part Postgres can actually do cheaply: measuring the frequency of a handful of query terms costs
// one indexed query (~7 ms on 12766 chunks), whereas an IDF-weighted ORDER BY would have to score
// every matching row.

/** A query term with how many chunks of the corpus contain it. */
export interface TermFrequency {
  /** The lexeme as plainto_tsquery emitted it, quoted: 'piec', '01.01.1976'. */
  term: string;
  df: number;
}

/**
 * A term in more than this share of the corpus carries no locating power and is dropped.
 *
 * One percent is deliberately strict. The purpose is not to keep "reasonably specific" words but to
 * isolate the handful that identify a passage; anything a hundredth of the corpus shares is a word
 * about law, not a word about this case. On the dev corpus this is a ceiling of ~128 chunks, which
 * keeps a date cited three times and drops "pièces".
 */
const MAX_DF_FRACTION = 0.01;

/**
 * A term is kept only if it is within this factor of the question's RAREST term.
 *
 * The absolute ceiling above is not enough on its own. In "Que disent les pièces au sujet du
 * 01.01.1976 ?" the word "sujet" occurs in 64 chunks — comfortably under one percent, and still
 * thirty times more common than the date the question is about. Disjoining it adds 64 candidates
 * competing with the 3 that matter, and the candidate cap then decides.
 *
 * Judging each term against the others in its own query is what makes this adapt: when every term is
 * comparably rare they are all kept, and when one is a genuine needle the filler around it is
 * dropped. The alternative — lowering the absolute percentage until the example passes — would be
 * fitting a constant to one question.
 */
const MAX_RELATIVE_DF = 10;

/**
 * Ceiling on how many terms are disjoined.
 *
 * Every extra term widens the candidate set, and beyond a few the rarest ones stop deciding the
 * ranking. Rare terms are taken first, so a long question keeps its needles and loses its filler.
 */
const MAX_TERMS = 8;

export interface DiscriminatingTerms {
  /** The terms worth searching, rarest first. Empty when the question has no distinctive word. */
  terms: string[];
  /** The tsquery source, terms disjoined; empty string when `terms` is empty. */
  tsquery: string;
}

/**
 * The terms of a question that actually locate a passage.
 *
 * Returns nothing when every term is common — a question made entirely of legal boilerplate has no
 * lexical signal, and inventing one would just add noise to the rank fusion. The caller is expected
 * to keep its existing behaviour in that case: measured, contributing NOTHING to the fusion beats
 * contributing a weak ranking, because weak lexical hits displace good dense hits in the top k.
 */
export function discriminatingTerms(
  frequencies: readonly TermFrequency[],
  corpusSize: number
): DiscriminatingTerms {
  if (corpusSize <= 0) return { terms: [], tsquery: "" };
  const ceiling = Math.max(1, Math.floor(corpusSize * MAX_DF_FRACTION));

  // df 0 means the term is nowhere in this corpus: keeping it cannot match anything, and it would
  // occupy one of the MAX_TERMS slots that a term which CAN match should have.
  const present = frequencies.filter((f) => f.df > 0 && f.df <= ceiling);
  const rarest = present.reduce(
    (min, f) => Math.min(min, f.df),
    Number.POSITIVE_INFINITY
  );

  const kept = present
    .filter((f) => f.df <= rarest * MAX_RELATIVE_DF)
    // Rarest first, ties broken on the term so the query is byte-identical between runs.
    .sort(
      (a, b) => a.df - b.df || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0)
    )
    .slice(0, MAX_TERMS)
    .map((f) => f.term);

  return { terms: kept, tsquery: kept.join(" | ") };
}

/**
 * Splits plainto_tsquery's rendered output back into its lexemes.
 *
 * Going through Postgres's own output rather than tokenising the question here is what keeps
 * stemming, stopword removal and the French/Dutch configurations identical to what the index was
 * built with. A second tokeniser in application code would drift from the first one silently.
 *
 * plainto_tsquery only ever emits ' & ' between lexemes — phrase operators come from
 * phraseto_tsquery, which is not used here.
 */
export function splitTsqueryTerms(rendered: string): string[] {
  return rendered
    .split(" & ")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}
