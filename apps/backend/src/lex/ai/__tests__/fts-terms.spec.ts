import { discriminatingTerms, splitTsqueryTerms } from "../fts-terms";

/** The real frequencies Postgres reported for a question that retrieval used to miss entirely. */
const REAL_QUESTION = [
  { term: "'disent'", df: 2 },
  { term: "'le'", df: 1351 },
  { term: "'piec'", df: 222 },
  { term: "'sujet'", df: 64 },
  { term: "'01.01.1976'", df: 3 }
];
const CORPUS = 12766;

describe("discriminatingTerms", () => {
  // The case the whole module exists for. Three chunks contain 01.01.1976 and the conjunctive query
  // returned none of them; disjoining everything drowned them under "pièces".
  it("keeps the terms that locate a passage and drops the boilerplate", () => {
    const { terms, tsquery } = discriminatingTerms(REAL_QUESTION, CORPUS);
    expect(terms).toEqual(["'disent'", "'01.01.1976'"]);
    expect(tsquery).toBe("'disent' | '01.01.1976'");
    expect(terms).not.toContain("'le'");
    expect(terms).not.toContain("'piec'");
    expect(terms).not.toContain("'sujet'");
  });

  it("orders rarest first, so the needles survive the term cap", () => {
    const { terms } = discriminatingTerms(
      Array.from({ length: 20 }, (_, i) => ({ term: `'t${i}'`, df: 20 - i })),
      CORPUS
    );
    expect(terms).toHaveLength(8);
    // df 1 is rarest and must be first; df 20 is the most common of the set and must be gone.
    expect(terms[0]).toBe("'t19'");
    expect(terms).not.toContain("'t0'");
  });

  it("breaks frequency ties deterministically, so the query is stable between runs", () => {
    const facts = [
      { term: "'zebra'", df: 3 },
      { term: "'alpha'", df: 3 }
    ];
    expect(discriminatingTerms(facts, CORPUS).terms).toEqual([
      "'alpha'",
      "'zebra'"
    ]);
    expect(discriminatingTerms([...facts].reverse(), CORPUS).terms).toEqual([
      "'alpha'",
      "'zebra'"
    ]);
  });

  // A question of pure legal boilerplate has no lexical signal. Measured: feeding a weak ranking into
  // the rank fusion is WORSE than feeding none, because the weak hits displace good dense hits.
  it("returns nothing when every term is common, rather than inventing signal", () => {
    const { terms, tsquery } = discriminatingTerms(
      [
        { term: "'piec'", df: 222 },
        { term: "'le'", df: 1351 }
      ],
      CORPUS
    );
    expect(terms).toEqual([]);
    expect(tsquery).toBe("");
  });

  it("drops a term absent from the corpus rather than spending a slot on it", () => {
    // df 0 can never match, and it would displace a term that can.
    const { terms } = discriminatingTerms(
      [
        { term: "'inexistant'", df: 0 },
        { term: "'01.01.1976'", df: 3 }
      ],
      CORPUS
    );
    expect(terms).toEqual(["'01.01.1976'"]);
  });

  it("scales its ceiling with the corpus rather than using a fixed count", () => {
    const term = [{ term: "'x'", df: 50 }];
    // 50 of 12766 is rare; 50 of 200 is half the file.
    expect(discriminatingTerms(term, CORPUS).terms).toEqual(["'x'"]);
    expect(discriminatingTerms(term, 200).terms).toEqual([]);
  });

  it("keeps a term in a tiny corpus, where one percent rounds below one", () => {
    // The floor exists so a five-document workspace is not left with no lexical query at all.
    expect(discriminatingTerms([{ term: "'x'", df: 1 }], 5).terms).toEqual([
      "'x'"
    ]);
  });

  it("handles an empty question and an empty corpus without throwing", () => {
    expect(discriminatingTerms([], CORPUS)).toEqual({ terms: [], tsquery: "" });
    expect(discriminatingTerms(REAL_QUESTION, 0)).toEqual({
      terms: [],
      tsquery: ""
    });
  });
});

describe("splitTsqueryTerms", () => {
  it("splits what plainto_tsquery actually renders", () => {
    expect(
      splitTsqueryTerms("'disent' & 'le' & 'piec' & 'sujet' & '01.01.1976'")
    ).toEqual(["'disent'", "'le'", "'piec'", "'sujet'", "'01.01.1976'"]);
  });

  it("returns nothing for an empty query, which is what a stopword-only question renders as", () => {
    expect(splitTsqueryTerms("")).toEqual([]);
    expect(splitTsqueryTerms("   ")).toEqual([]);
  });

  it("keeps a single term intact", () => {
    expect(splitTsqueryTerms("'nerincx'")).toEqual(["'nerincx'"]);
  });

  it("does not split inside a lexeme that contains the separator's characters", () => {
    // A quoted lexeme can hold spaces and ampersands; only ' & ' between lexemes separates them.
    expect(splitTsqueryTerms("'a&b' & 'c'")).toEqual(["'a&b'", "'c'"]);
  });
});
