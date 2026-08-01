import {
  amountCases,
  buildGeneratedCases,
  compareRuns,
  dateCases,
  personCases,
  scoreCase,
  summarise,
  type CaseResult,
  type CorpusFact,
  type EvalCase
} from "../eval-cases";

const fact = (literal: string, ...documentIds: string[]): CorpusFact => ({
  literal,
  documentIds
});

describe("case generation", () => {
  // A case only measures something if its answer can be wrong. On the real corpus
  // "1.500.000 BEF" is in eighteen documents, so almost any retriever satisfies it.
  it("keeps only facts distinctive enough to have a findable answer", () => {
    const cases = amountCases([
      fact("45.500.000 BEF", "a"),
      fact("12.991.800 BEF", "a", "b", "c"),
      fact("1.500.000 BEF", "a", "b", "c", "d")
    ]);
    // Sorted by literal for determinism, so assert membership rather than input order.
    expect(cases.map((c) => c.expectedDocumentIds.length).sort()).toEqual([
      1, 3
    ]);
    expect(cases.some((c) => c.id.includes("1.500.000"))).toBe(false);
  });

  it("drops a literal too short to be anything but an artefact", () => {
    expect(amountCases([fact("2 €", "a")])).toEqual([]);
  });

  it("quotes the fact as the document writes it, so full-text retrieval is exercised", () => {
    const [amount] = amountCases([fact("45.500.000 BEF", "a")]);
    expect(amount.question).toContain("45.500.000 BEF");
    const [date] = dateCases([fact("27 mai 1998", "a")]);
    expect(date.question).toContain("27 mai 1998");
    const [person] = personCases([fact("François Kumps", "a", "b")]);
    expect(person.question).toContain("François Kumps");
  });

  it("gives every case a stable, readable id and dedupes its expected documents", () => {
    const [one] = amountCases([fact("45.500.000 BEF", "b", "a", "b")]);
    const [two] = amountCases([fact("45.500.000 BEF", "a", "b")]);
    expect(one.id).toBe(two.id);
    expect(one.id).toBe("amount:45.500.000_bef");
    expect(one.expectedDocumentIds).toEqual(["a", "b"]);
  });

  it("is deterministic: the same corpus gives byte-identical cases", () => {
    const facts = [fact("b 1000 EUR", "x"), fact("a 2000 EUR", "y")];
    expect(JSON.stringify(amountCases(facts))).toBe(
      JSON.stringify(amountCases([...facts].reverse()))
    );
  });

  // Drawing purely by rarity would fill the suite with dates — there are 625 of them on the real
  // corpus against 41 documents holding amounts — and stop measuring the other paths.
  it("balances the suite across kinds rather than following the longest tail", () => {
    const cases = buildGeneratedCases(
      {
        amounts: [fact("1.000 EUR", "a"), fact("2.000 EUR", "b")],
        dates: Array.from({ length: 50 }, (_, i) =>
          fact(`${i + 1} mai 1998`, `d${i}`)
        ),
        people: [fact("François Kumps", "a")]
      },
      2
    );
    expect(cases.filter((c) => c.kind === "amount")).toHaveLength(2);
    expect(cases.filter((c) => c.kind === "date")).toHaveLength(2);
    expect(cases.filter((c) => c.kind === "person")).toHaveLength(1);
  });

  it("produces nothing from an empty corpus rather than throwing", () => {
    expect(buildGeneratedCases({ amounts: [], dates: [], people: [] })).toEqual(
      []
    );
  });
});

describe("scoring", () => {
  const evalCase: EvalCase = {
    id: "amount:x",
    kind: "amount",
    question: "?",
    expectedDocumentIds: ["a", "b"]
  };

  it("passes when any expected document comes back, and reports how many did", () => {
    const result = scoreCase(evalCase, ["z", "a", "y"]);
    expect(result.hit).toBe(true);
    expect(result.recall).toBe(0.5);
    expect(result.firstHitRank).toBe(2);
  });

  it("fails cleanly when nothing expected comes back", () => {
    const result = scoreCase(evalCase, ["y", "z"]);
    expect(result.hit).toBe(false);
    expect(result.recall).toBe(0);
    expect(result.firstHitRank).toBeNull();
  });

  // Retrieval returns CHUNKS. Three chunks of one document in the top three is one document found,
  // and ranking it as three would flatter every score in the suite.
  it("ranks by distinct document, not by chunk", () => {
    const result = scoreCase(evalCase, ["z", "z", "z", "a"]);
    expect(result.retrievedDocumentIds).toEqual(["z", "a"]);
    expect(result.firstHitRank).toBe(2);
  });

  it("does not penalise a retriever for also returning something related", () => {
    // Extra documents are not wrong — precision is not the metric, and demanding it would reward a
    // retriever that returns too little.
    const result = scoreCase(evalCase, ["a", "b", "q", "r", "s"]);
    expect(result.recall).toBe(1);
    expect(result.hit).toBe(true);
  });
});

describe("summary", () => {
  const result = (
    caseId: string,
    hit: boolean,
    kind: CaseResult["kind"] = "amount"
  ): CaseResult => ({
    caseId,
    kind,
    retrievedDocumentIds: [],
    expectedDocumentIds: ["a"],
    hit,
    recall: hit ? 1 : 0,
    firstHitRank: hit ? 1 : null
  });

  it("reports the rate overall and per kind, and lists what missed", () => {
    const s = summarise([
      result("a", true),
      result("b", false),
      result("c", true, "date")
    ]);
    expect(s.total).toBe(3);
    expect(s.hits).toBe(2);
    expect(s.hitRate).toBeCloseTo(2 / 3);
    expect(s.byKind.amount).toEqual({ total: 2, hits: 1 });
    expect(s.byKind.date).toEqual({ total: 1, hits: 1 });
    expect(s.misses.map((m) => m.caseId)).toEqual(["b"]);
  });

  it("handles an empty run without dividing by zero", () => {
    expect(summarise([])).toMatchObject({
      total: 0,
      hitRate: 0,
      meanRecall: 0
    });
  });
});

describe("comparing runs", () => {
  const result = (caseId: string, hit: boolean): CaseResult => ({
    caseId,
    kind: "amount",
    retrievedDocumentIds: [],
    expectedDocumentIds: ["a"],
    hit,
    recall: hit ? 1 : 0,
    firstHitRank: hit ? 1 : null
  });

  // The actionable signal. A single score tells nobody whether 0.84 is good; a case that USED to be
  // found and now is not is a retrieval regression, which is the shape of every silent bug this app
  // has shipped.
  it("names the cases that stopped being found", () => {
    const diff = compareRuns(
      [result("a", true), result("b", true), result("c", false)],
      [result("a", true), result("b", false), result("c", true)]
    );
    expect(diff.regressed).toEqual(["b"]);
    expect(diff.fixed).toEqual(["c"]);
  });

  it("says when the suite itself changed, so a score shift is not misread", () => {
    const diff = compareRuns([result("a", true)], [result("b", true)]);
    expect(diff.added).toEqual(["b"]);
    expect(diff.removed).toEqual(["a"]);
    // A case absent from one side is neither a regression nor a fix.
    expect(diff.regressed).toEqual([]);
    expect(diff.fixed).toEqual([]);
  });

  it("compares an empty baseline without reporting phantom regressions", () => {
    const diff = compareRuns([], [result("a", false)]);
    expect(diff.regressed).toEqual([]);
    expect(diff.added).toEqual(["a"]);
  });
});
