import type { LexStoryAmount } from "@packages/types";
import {
  buildExposeDesFaits,
  buildYearBands,
  capRows,
  chooseChronologyCut,
  chooseDefaultThreshold,
  chronologyFits,
  CORROBORATION_CUTS,
  countFactsByThreshold,
  countTermsInFacts,
  DEFAULT_THRESHOLD_LADDER,
  factsAsTimelineItems,
  filterFacts,
  findNearIdenticalAmounts,
  findRecurringAmounts,
  formatAmount,
  groupAmountsByDocument,
  groupIdenticalAmounts,
  MAX_DEFAULT_ROWS,
  orderFacts,
  REGISTRY_RENDER_CAP,
  summariseMoney,
  type RegistryFactLike
} from "../caseStory";

const at = (id: string, date: string) => ({ id, date });

const fact = (over: Partial<RegistryFactLike> = {}): RegistryFactLike => ({
  iso: "1998-05-27",
  documentCount: 1,
  mentionCount: 1,
  ...over
});

const amount = (over: Partial<LexStoryAmount> = {}): LexStoryAmount => ({
  documentId: "d1",
  chunkId: "c1",
  value: 1000,
  currency: "BEF",
  raw: "1.000 BEF",
  excerpt: "…1.000 BEF…",
  charStart: 0,
  charEnd: 9,
  pageFrom: 1,
  pageTo: 1,
  ...over
});

describe("buildYearBands", () => {
  // The real distribution: 16 years across seven decades, 1 document in 1958, then clusters of 7, 8
  // and 8. A continuous axis puts 1958 alone at the left and crushes the rest into the right tenth.
  it("groups by year and orders bands chronologically", () => {
    const b = buildYearBands([
      at("c", "2024-03-01"),
      at("a", "1958-07-10"),
      at("b", "2024-01-05")
    ]);
    expect(b.bands.map((x) => x.year)).toEqual(["1958", "2024"]);
    expect(b.bands[1].items.map((i) => i.id)).toEqual(["b", "c"]);
    expect(b.maxCount).toBe(2);
  });

  it("marks a run of empty years and says how many it hides", () => {
    const b = buildYearBands([at("a", "1958-07-10"), at("b", "1989-04-29")]);
    expect(b.gaps).toEqual([
      { beforeIndex: 1, fromYear: "1959", toYear: "1988", years: 30 }
    ]);
  });

  it("marks every gap in a file with several", () => {
    const b = buildYearBands([
      at("a", "1992-01-05"),
      at("b", "1996-01-05"),
      at("c", "1997-01-05"),
      at("d", "2004-01-05")
    ]);
    // 1993-1995 and 1998-2003 are marked; 1996->1997 is consecutive and is not.
    expect(b.gaps.map((g) => `${g.fromYear}-${g.toYear}`)).toEqual([
      "1993-1995",
      "1998-2003"
    ]);
    expect(b.gaps.map((g) => g.beforeIndex)).toEqual([1, 3]);
  });

  it("does not mark a single missing year, which is spacing rather than a silence", () => {
    const b = buildYearBands([at("a", "2020-01-01"), at("b", "2022-01-01")]);
    expect(b.gaps).toEqual([]);
  });

  it("keeps undated items rather than dropping them", () => {
    // A piece with no extracted date is still a piece of the file.
    const b = buildYearBands([
      at("dated", "2024-01-01"),
      at("none", ""),
      at("bad", "not-a-date"),
      at("partial", "2024-01")
    ]);
    expect(b.bands).toHaveLength(1);
    expect(b.undated.map((u) => u.id).sort()).toEqual([
      "bad",
      "none",
      "partial"
    ]);
  });

  it("reports the tallest band so a caller can scale the stack", () => {
    const b = buildYearBands([
      at("a", "2023-01-01"),
      at("b", "2023-02-01"),
      at("c", "2023-03-01"),
      at("d", "2024-01-01")
    ]);
    expect(b.maxCount).toBe(3);
  });

  it("handles an empty file and an all-undated file", () => {
    expect(buildYearBands([]).bands).toEqual([]);
    const none = buildYearBands([at("a", ""), at("b", "")]);
    expect(none.bands).toEqual([]);
    expect(none.maxCount).toBe(0);
    expect(none.undated).toHaveLength(2);
  });

  it("is deterministic, including for items sharing a date", () => {
    const items = [
      at("b", "1992-01-05"),
      at("a", "1992-01-05"),
      at("c", "2024-01-01")
    ];
    const first = buildYearBands(items);
    const second = buildYearBands([...items].reverse());
    expect(first.bands[0].items.map((i) => i.id)).toEqual(
      second.bands[0].items.map((i) => i.id)
    );
  });
});

describe("summariseMoney", () => {
  it("totals each currency separately, in the currency the file uses", () => {
    const s = summariseMoney([
      amount({ value: 4000000, currency: "BEF" }),
      amount({ value: 521000, currency: "BEF" }),
      amount({ value: 50000, currency: "EUR", documentId: "d2" })
    ]);
    expect(s.byCurrency).toEqual([
      { currency: "BEF", total: 4521000, count: 2, eur: 112072.66 },
      { currency: "EUR", total: 50000, count: 1, eur: 50000 }
    ]);
    expect(s.amountCount).toBe(3);
    expect(s.documentCount).toBe(2);
  });

  // The integrity rule. A dollar amount has no legally fixed euro rate, so it cannot join the euro
  // total — and it must not be counted as zero either, which would make the total look complete.
  it("excludes an unconvertible currency from the euro total and names it", () => {
    const s = summariseMoney([
      amount({ value: 100000, currency: "BEF" }),
      amount({ value: 25000, currency: "USD" }),
      amount({ value: 900, currency: "CHF" })
    ]);
    expect(s.unconvertible.map((u) => u.currency).sort()).toEqual([
      "CHF",
      "USD"
    ]);
    // 100000 BEF only — the dollars and francs suisses are absent, not zero.
    expect(s.convertibleEur).toBe(2478.94);
    // The dollars are still reported, in dollars.
    expect(s.byCurrency.find((c) => c.currency === "USD")).toEqual({
      currency: "USD",
      total: 25000,
      count: 1,
      eur: null
    });
  });

  it("returns a null euro total when nothing is convertible", () => {
    const s = summariseMoney([amount({ value: 100, currency: "GBP" })]);
    expect(s.convertibleEur).toBeNull();
  });

  it("handles an empty file", () => {
    const s = summariseMoney([]);
    expect(s).toEqual({
      byCurrency: [],
      convertibleEur: null,
      unconvertible: [],
      amountCount: 0,
      documentCount: 0
    });
  });

  it("keeps negatives, which are real in a liquidation statement", () => {
    const s = summariseMoney([
      amount({ value: 20475000, currency: "BEF" }),
      amount({ value: -2510691, currency: "BEF" })
    ]);
    expect(s.byCurrency[0].total).toBe(17964309);
  });

  it("orders currencies by how much of the file uses them", () => {
    const s = summariseMoney([
      amount({ value: 1, currency: "EUR" }),
      amount({ value: 1, currency: "BEF" }),
      amount({ value: 1, currency: "BEF" })
    ]);
    expect(s.byCurrency.map((c) => c.currency)).toEqual(["BEF", "EUR"]);
  });
});

describe("groupAmountsByDocument", () => {
  it("groups and puts the largest amount first", () => {
    const grouped = groupAmountsByDocument([
      amount({ documentId: "a", value: 100, charStart: 0 }),
      amount({ documentId: "a", value: 9000, charStart: 50 }),
      amount({ documentId: "b", value: 5, charStart: 0 })
    ]);
    expect([...grouped.keys()]).toEqual(["a", "b"]);
    expect(grouped.get("a")!.map((x) => x.value)).toEqual([9000, 100]);
  });

  it("ranks by magnitude, so a large debit is as prominent as a large credit", () => {
    const grouped = groupAmountsByDocument([
      amount({ documentId: "a", value: 100 }),
      amount({ documentId: "a", value: -9000, charStart: 9 })
    ]);
    expect(grouped.get("a")!.map((x) => x.value)).toEqual([-9000, 100]);
  });
});

describe("formatAmount", () => {
  it("writes amounts the way a Belgian filing does", () => {
    expect(formatAmount(4000000, "BEF")).toBe("4.000.000 BEF");
    expect(formatAmount(1234.56, "EUR")).toBe("1.234,56 EUR");
    expect(formatAmount(-2510691, "BEF")).toBe("-2.510.691 BEF");
    expect(formatAmount(0, "EUR")).toBe("0 EUR");
    expect(formatAmount(999, "BEF")).toBe("999 BEF");
  });

  it("does not localise the currency away", () => {
    // Intl with style:"currency" renders BEF via locale data we do not control; the figure has to
    // read like the document it came from.
    expect(formatAmount(1000, "BEF")).toContain("BEF");
    expect(formatAmount(1000, "CHF")).toContain("CHF");
  });
});

describe("groupIdenticalAmounts", () => {
  // A brief restates a figure each time it argues about it: the real corpus has "12.991.800 BEF" four
  // times in one document. Ungrouped, ten sums read as forty.
  it("collapses repeated statements of one sum and keeps the pages", () => {
    const groups = groupIdenticalAmounts([
      amount({ value: 12991800, charStart: 10, pageFrom: 4 }),
      amount({ value: 12991800, charStart: 90, pageFrom: 7 }),
      amount({ value: 12991800, charStart: 50, pageFrom: 17 }),
      amount({ value: 11500000, charStart: 20, pageFrom: 4 })
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].value).toBe(12991800);
    expect(groups[0].occurrences).toHaveLength(3);
    expect(groups[0].pages).toEqual([4, 7, 17]);
    // Occurrences read in document order, not the order they arrived.
    expect(groups[0].occurrences.map((o) => o.charStart)).toEqual([10, 50, 90]);
  });

  it("keeps two currencies apart even at the same number", () => {
    const groups = groupIdenticalAmounts([
      amount({ value: 1000, currency: "BEF" }),
      amount({ value: 1000, currency: "EUR" })
    ]);
    expect(groups).toHaveLength(2);
  });

  it("orders by magnitude, so a large debit ranks with a large credit", () => {
    const groups = groupIdenticalAmounts([
      amount({ value: 500 }),
      amount({ value: -9000, charStart: 5 })
    ]);
    expect(groups.map((g) => g.value)).toEqual([-9000, 500]);
  });

  it("tolerates an unknown page rather than inventing one", () => {
    const groups = groupIdenticalAmounts([
      amount({ value: 1, pageFrom: null }),
      amount({ value: 1, charStart: 9, pageFrom: 3 })
    ]);
    expect(groups[0].pages).toEqual([3]);
    expect(groups[0].occurrences).toHaveLength(2);
  });
});

describe("findRecurringAmounts", () => {
  // The one narrative thread available with no inference: the same number in several filings is the
  // same transaction being argued in several places.
  it("finds sums stated in more than one document", () => {
    const recurring = findRecurringAmounts([
      amount({ documentId: "deed1996", value: 12991800 }),
      amount({ documentId: "note2020", value: 12991800, charStart: 5 }),
      amount({ documentId: "concl2024", value: 12991800, charStart: 9 }),
      amount({ documentId: "concl2024", value: 12991800, charStart: 40 }),
      amount({ documentId: "deed1996", value: 777, charStart: 60 })
    ]);
    expect(recurring).toHaveLength(1);
    expect(recurring[0].value).toBe(12991800);
    expect(recurring[0].documentIds).toEqual([
      "concl2024",
      "deed1996",
      "note2020"
    ]);
    expect(recurring[0].occurrenceCount).toBe(4);
    // One sample per document, the earliest in each.
    expect(recurring[0].samples).toHaveLength(3);
    expect(
      recurring[0].samples.find((s) => s.documentId === "concl2024")!.charStart
    ).toBe(9);
  });

  it("ignores a sum restated many times inside ONE document", () => {
    // Repetition within a filing is rhetoric; repetition across filings is a thread.
    const recurring = findRecurringAmounts([
      amount({ documentId: "a", value: 5, charStart: 1 }),
      amount({ documentId: "a", value: 5, charStart: 2 }),
      amount({ documentId: "a", value: 5, charStart: 3 })
    ]);
    expect(recurring).toEqual([]);
  });

  it("ranks by how many documents argue the figure, not by its size", () => {
    const recurring = findRecurringAmounts([
      amount({ documentId: "a", value: 100 }),
      amount({ documentId: "b", value: 100 }),
      amount({ documentId: "c", value: 100 }),
      amount({ documentId: "a", value: 9999999, charStart: 9 }),
      amount({ documentId: "b", value: 9999999, charStart: 9 })
    ]);
    expect(recurring.map((r) => r.value)).toEqual([100, 9999999]);
  });

  it("is deterministic regardless of input order", () => {
    const input = [
      amount({ documentId: "b", value: 7 }),
      amount({ documentId: "a", value: 7, charStart: 3 })
    ];
    const a = findRecurringAmounts(input);
    const b = findRecurringAmounts([...input].reverse());
    expect(a[0].documentIds).toEqual(b[0].documentIds);
  });
});

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/**
 * The real corpus in miniature: 608 distinct dates, 55 stated by 5 or more documents, 124 by 3 or
 * more, 230 by 2 or more. Five facts here stand in for that shape, with the file's actual dates.
 */
const REGISTRY: RegistryFactLike[] = [
  fact({
    iso: "1992-01-05",
    documentCount: 17,
    mentionCount: 40,
    notions: ["donation"],
    amounts: [{ value: 1500000, currency: "BEF", documentCount: 3 }],
    refs: ["annexe 5"]
  }),
  fact({
    iso: "1996-06-24",
    documentCount: 14,
    mentionCount: 22,
    notions: ["donation", "rapport"],
    amounts: [
      { value: 934628, currency: "BEF", documentCount: 7 },
      { value: 934623, currency: "BEF", documentCount: 1 }
    ]
  }),
  fact({
    iso: "1998-05-27",
    documentCount: 17,
    mentionCount: 31,
    notions: ["reserve"],
    milestones: ["declaration-succession"]
  }),
  fact({
    iso: "2020-10-07",
    documentCount: 4,
    mentionCount: 9,
    milestones: ["pv-ouverture"],
    refs: ["pièce 1"]
  }),
  fact({ iso: "2023-11-13", documentCount: 1, mentionCount: 1 })
];

describe("countFactsByThreshold", () => {
  it("counts each cut and says what it hides", () => {
    expect(countFactsByThreshold(REGISTRY)).toEqual([
      { threshold: 5, count: 3, hidden: 2 },
      { threshold: 3, count: 4, hidden: 1 },
      { threshold: 2, count: 4, hidden: 1 },
      { threshold: 1, count: 5, hidden: 0 }
    ]);
  });

  // The panel's caption is built from this, so the pair must always add up: a cap that does not state
  // what it hid is the failure mode this view exists to avoid.
  it("always accounts for every fact", () => {
    for (const cut of countFactsByThreshold(REGISTRY))
      expect(cut.count + cut.hidden).toBe(REGISTRY.length);
  });

  it("offers the cuts in the order the control bar renders them", () => {
    expect(CORROBORATION_CUTS).toEqual([5, 3, 2, 1]);
  });
});

describe("chooseDefaultThreshold", () => {
  const manyAt = (documentCount: number, n: number) =>
    Array.from({ length: n }, (_, i) =>
      fact({ iso: `20${10 + (i % 80)}-01-01`, documentCount })
    );

  it("opens on the lowest rung that fits the budget", () => {
    // Today's corpus: 55 rows at 5 pièces, well under 120, so the page opens at the first rung.
    expect(chooseDefaultThreshold(manyAt(5, 55))).toBe(5);
    expect(DEFAULT_THRESHOLD_LADDER[0]).toBe(5);
  });

  // Lowest, not first-that-looks-tidy: every rung climbed hides facts, so the default gives away as
  // little as the budget allows. At ten times this corpus the first rung stops fitting.
  it("climbs only as far as it must", () => {
    // 300 facts at 9 pièces clear the first three rungs' budget; only the 10th thins them out.
    const facts = [...manyAt(9, 200), ...manyAt(12, 100)];
    expect(chooseDefaultThreshold(facts)).toBe(10);
    expect(
      facts.filter((f) => f.documentCount >= 10).length
    ).toBeLessThanOrEqual(MAX_DEFAULT_ROWS);
  });

  it("returns the top rung rather than nothing when even that is over budget", () => {
    const facts = manyAt(99, 500);
    expect(chooseDefaultThreshold(facts)).toBe(
      DEFAULT_THRESHOLD_LADDER[DEFAULT_THRESHOLD_LADDER.length - 1]
    );
  });

  it("handles an empty file", () => {
    expect(chooseDefaultThreshold([])).toBe(5);
  });
});

describe("capRows", () => {
  it("caps and reports the remainder", () => {
    const rows = Array.from({ length: 320 }, (_, i) => i);
    expect(capRows(rows).rows).toHaveLength(REGISTRY_RENDER_CAP);
    expect(capRows(rows).hidden).toBe(320 - REGISTRY_RENDER_CAP);
    expect(capRows(rows, 10)).toEqual({ rows: rows.slice(0, 10), hidden: 310 });
  });

  it("hides nothing when everything fits", () => {
    expect(capRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], hidden: 0 });
  });
});

describe("filterFacts", () => {
  it("applies the corroboration cut", () => {
    expect(
      filterFacts(REGISTRY, { minDocuments: 5 }).map((f) => f.iso)
    ).toEqual(["1992-01-05", "1996-06-24", "1998-05-27"]);
  });

  it("filters to a year, which is what clicking a band does", () => {
    expect(filterFacts(REGISTRY, { year: "2020" }).map((f) => f.iso)).toEqual([
      "2020-10-07"
    ]);
  });

  it("filters on carrying an amount or a reference", () => {
    expect(
      filterFacts(REGISTRY, { requireAmount: true }).map((f) => f.iso)
    ).toEqual(["1992-01-05", "1996-06-24"]);
    expect(
      filterFacts(REGISTRY, { requireRef: true }).map((f) => f.iso)
    ).toEqual(["1992-01-05", "2020-10-07"]);
  });

  it("matches a term in any of the three vocabularies", () => {
    expect(
      filterFacts(REGISTRY, { terms: ["pv-ouverture"] }).map((f) => f.iso)
    ).toEqual(["2020-10-07"]);
    expect(
      filterFacts(REGISTRY, { terms: ["rapport"] }).map((f) => f.iso)
    ).toEqual(["1996-06-24"]);
  });

  // THE CONTROL BAR'S PROMISE, asserted rather than trusted. Chips show their count within the cut
  // and a chip at zero is disabled, so clicking any enabled chip must leave something on screen.
  // Intersection semantics would break that — two healthy chips can share no fact.
  it("never empties the table for a chip that shows a count", () => {
    const cut = filterFacts(REGISTRY, { minDocuments: 2 });
    for (const term of countTermsInFacts(cut))
      if (term.count > 0)
        expect(filterFacts(cut, { terms: [term.id] }).length).toBe(term.count);
    // Two chips together widen rather than narrow.
    expect(
      filterFacts(cut, { terms: ["rapport", "pv-ouverture"] }).map((f) => f.iso)
    ).toEqual(["1996-06-24", "2020-10-07"]);
  });

  it("combines the controls", () => {
    expect(
      filterFacts(REGISTRY, {
        minDocuments: 5,
        terms: ["donation"],
        requireAmount: true
      }).map((f) => f.iso)
    ).toEqual(["1992-01-05", "1996-06-24"]);
  });

  it("returns everything when nothing is asked", () => {
    expect(filterFacts(REGISTRY)).toHaveLength(REGISTRY.length);
  });
});

describe("orderFacts", () => {
  // A ledger reads in time. This inverts the earlier acts panel, which led with the most-cited date.
  it("reads chronologically", () => {
    expect(orderFacts(REGISTRY, "chronological").map((f) => f.iso)).toEqual([
      "1992-01-05",
      "1996-06-24",
      "1998-05-27",
      "2020-10-07",
      "2023-11-13"
    ]);
  });

  it("ranks by how many documents state the date when asked", () => {
    // 1992 and 1998 are both stated by 17 documents; the mention count breaks the tie.
    expect(orderFacts(REGISTRY, "weight").map((f) => f.iso)).toEqual([
      "1992-01-05",
      "1998-05-27",
      "1996-06-24",
      "2020-10-07",
      "2023-11-13"
    ]);
  });

  it("is deterministic and does not mutate its input", () => {
    const before = REGISTRY.map((f) => f.iso);
    const a = orderFacts(REGISTRY, "weight").map((f) => f.iso);
    const b = orderFacts([...REGISTRY].reverse(), "weight").map((f) => f.iso);
    expect(a).toEqual(b);
    expect(REGISTRY.map((f) => f.iso)).toEqual(before);
  });
});

describe("countTermsInFacts", () => {
  it("counts facts, not mentions", () => {
    expect(countTermsInFacts(REGISTRY)).toEqual([
      { id: "donation", count: 2 },
      { id: "declaration-succession", count: 1 },
      { id: "pv-ouverture", count: 1 },
      { id: "rapport", count: 1 },
      { id: "reserve", count: 1 }
    ]);
  });

  // A chip that vanishes says nothing; a chip disabled at "0" says the file is silent on that notion,
  // which on the real corpus is a finding in itself — the art. 918 trigger set appears nowhere.
  it("keeps a zero row for a term the cut does not contain", () => {
    expect(
      countTermsInFacts(REGISTRY, ["donation", "recel", "reserve-usufruit"])
    ).toEqual([
      { id: "donation", count: 2 },
      { id: "recel", count: 0 },
      { id: "reserve-usufruit", count: 0 }
    ]);
  });

  it("counts a term twice on one fact only once", () => {
    expect(
      countTermsInFacts([
        fact({ notions: ["donation"], qualifications: ["donation"] })
      ])
    ).toEqual([{ id: "donation", count: 1 }]);
  });
});

describe("factsAsTimelineItems", () => {
  // The substantive change the registry makes to the chronology: a 1996 purchase argued in a 2024
  // filing lands in 1996, where it happened, instead of in 2024, where it was last mentioned.
  it("bands the chronology on the date the text writes", () => {
    const bands = buildYearBands(factsAsTimelineItems(REGISTRY));
    expect(bands.bands.map((b) => b.year)).toEqual([
      "1992",
      "1996",
      "1998",
      "2020",
      "2023"
    ]);
    // 1997 alone is spacing, not a silence; 1999-2019 is the 21-year one the layout must name.
    expect(bands.gaps.map((g) => g.years)).toEqual([3, 21, 2]);
  });

  it("gives each block the identity of its date, so a click can find the row", () => {
    expect(factsAsTimelineItems([fact({ iso: "1992-01-05" })])).toEqual([
      { id: "1992-01-05", date: "1992-01-05" }
    ]);
  });
});

describe("findNearIdenticalAmounts", () => {
  const amount = (value: number, documentCount = 1, currency = "BEF") => ({
    value,
    currency,
    documentCount
  });

  // The one real finding on the flagship corpus: 24 June 1996 carries 934.628 BEF in seven pièces and
  // 934.623 BEF in one. Shown inline, with both excerpts, and with no verdict.
  it("pairs two figures a hair apart when one side is corroborated", () => {
    const pairs = findNearIdenticalAmounts([
      amount(934628, 7),
      amount(934623, 1)
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].primary.value).toBe(934628);
    expect(pairs[0].other.value).toBe(934623);
  });

  // The obvious rule — "the same date carries two different amounts" — fires on 314 of 626 facts on
  // the real corpus. Every clause below is what takes that to three.
  it("refuses everything that is merely two different sums", () => {
    // A percent or more apart: two figures, not one figure written twice.
    expect(
      findNearIdenticalAmounts([amount(1500000, 5), amount(1400000, 3)])
    ).toEqual([]);
    // Too small to be a disputed valuation.
    expect(findNearIdenticalAmounts([amount(502, 5), amount(500, 3)])).toEqual(
      []
    );
    // Neither side corroborated: one document arguing with itself.
    expect(
      findNearIdenticalAmounts([amount(934628, 1), amount(934623, 1)])
    ).toEqual([]);
    // The same figure twice is not a divergence.
    expect(
      findNearIdenticalAmounts([amount(934628, 7), amount(934628, 2)])
    ).toEqual([]);
    // Different currencies are not comparable, and a fixed 1999 rate would not make them so.
    expect(
      findNearIdenticalAmounts([amount(934628, 7), amount(934623, 3, "EUR")])
    ).toEqual([]);
    // A credit and a debit of the same size are the two sides of one movement, not a disagreement.
    expect(
      findNearIdenticalAmounts([amount(934628, 7), amount(-934623, 3)])
    ).toEqual([]);
  });

  it("leads with the better-corroborated figure whatever order it arrives in", () => {
    const forwards = findNearIdenticalAmounts([
      amount(934623, 1),
      amount(934628, 7)
    ]);
    const backwards = findNearIdenticalAmounts([
      amount(934628, 7),
      amount(934623, 1)
    ]);
    expect(forwards).toEqual(backwards);
    expect(forwards[0].primary.documentCount).toBe(7);
  });

  it("handles a fact with no amounts, or one", () => {
    expect(findNearIdenticalAmounts([])).toEqual([]);
    expect(findNearIdenticalAmounts([amount(934628, 7)])).toEqual([]);
  });
});

describe("buildExposeDesFaits", () => {
  const rows = [
    {
      iso: "1992-01-05",
      excerpt: "Donation\n  augmentation de capital IMMO AMBRE",
      source: "conclusions.pdf",
      page: 12
    },
    {
      iso: "1998-05-27",
      excerpt: "Monsieur Jacques PIRSON est décédé le 27 mai 1998",
      source: "état liquidatif.pdf",
      page: null
    }
  ];

  // The artefact art. 744 3° C. jud. actually asks for: the facts, in order, each with the document's
  // own sentence and a pin cite. The numbering is the row number on screen, so a line quoted at a
  // hearing and a row on the page are the same row.
  it("numbers the rows and quotes the document", () => {
    expect(buildExposeDesFaits(rows)).toBe(
      "1 · 1992-01-05 · « Donation augmentation de capital IMMO AMBRE » · conclusions.pdf, p. 12\n" +
        "2 · 1998-05-27 · « Monsieur Jacques PIRSON est décédé le 27 mai 1998 » · état liquidatif.pdf"
    );
  });

  // Text copied out of a filtered table without saying it was filtered is the one way this could
  // mislead, so the header travels with it.
  it("carries the caller's header", () => {
    expect(
      buildExposeDesFaits(rows.slice(0, 1), "Faits — 5 pièces et plus")
    ).toBe(
      "Faits — 5 pièces et plus\n\n" +
        "1 · 1992-01-05 · « Donation augmentation de capital IMMO AMBRE » · conclusions.pdf, p. 12"
    );
  });

  it("copies an empty selection as nothing rather than as a heading with no facts", () => {
    expect(buildExposeDesFaits([])).toBe("");
  });
});

describe("chooseChronologyCut", () => {
  const dates = (spec: [string, number][]) =>
    spec.map(([iso, documentCount]) => ({ iso, documentCount }));
  const geometry = { bandWidth: 34, gapWidth: 24, maxWidth: 1152 };
  const fits = (isoDates: readonly string[]) =>
    chronologyFits(isoDates, geometry);

  // Measured on the real corpus: at min=2 the chronology is 49 bands and 2002px with a stack of 42;
  // at min=5 it is 23 bands and 998px. A constant would have been fitted to this one file.
  it("loosens the cut until the chronology would overflow, then stops", () => {
    // 40 distinct years, each cited once — only a strict cut can shrink this.
    const wide = dates(
      Array.from(
        { length: 40 },
        (_, i) => [`${1960 + i}-01-01`, 1] as [string, number]
      )
    );
    // Nothing survives min>=2, so the search runs to the ceiling.
    expect(chooseChronologyCut(wide, fits).minDocuments).toBeGreaterThan(1);
  });

  it("uses the loosest cut when the whole chronology already fits", () => {
    const narrow = dates([
      ["1998-05-27", 1],
      ["2020-10-07", 1]
    ]);
    const cut = chooseChronologyCut(narrow, fits);
    expect(cut.minDocuments).toBe(1);
    expect(cut.omitted).toBe(0);
  });

  it("reports what the cut hid, so the chart can admit it", () => {
    const mixed = dates([
      ["1998-01-01", 9],
      ["1999-01-01", 1],
      ["2000-01-01", 1]
    ]);
    const cut = chooseChronologyCut(mixed, () => false, 3);
    expect(cut.minDocuments).toBe(3);
    expect(cut.kept).toBe(1);
    expect(cut.omitted).toBe(2);
  });

  it("handles an empty chronology", () => {
    expect(chooseChronologyCut([], fits)).toEqual({
      minDocuments: 1,
      kept: 0,
      omitted: 0
    });
  });
});

describe("chronologyFits", () => {
  const geometry = { bandWidth: 34, gapWidth: 24, maxWidth: 1152 };

  it("counts a band per populated year and a marker per real gap", () => {
    // 1958 and 1998: two bands plus one gap = 34*2 + 24 = 92.
    expect(chronologyFits(["1958-07-10", "1998-05-27"], geometry)).toBe(true);
  });

  it("refuses a chronology that would overflow", () => {
    const many = Array.from({ length: 40 }, (_, i) => `${1960 + i}-01-01`);
    expect(chronologyFits(many, geometry)).toBe(false);
  });

  it("counts one band for several dates in the same year", () => {
    const sameYear = ["1998-01-27", "1998-05-27", "1998-12-31"];
    expect(chronologyFits(sameYear, { ...geometry, maxWidth: 34 })).toBe(true);
  });

  it("treats an empty chronology as fitting", () => {
    expect(chronologyFits([], geometry)).toBe(true);
  });
});
