import type { LexStoryAmount } from "@packages/types";
import {
  buildYearBands,
  findRecurringAmounts,
  formatAmount,
  groupAmountsByDocument,
  groupIdenticalAmounts,
  moneyByYear,
  summariseMoney
} from "../caseStory";

const at = (id: string, date: string) => ({ id, date });

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

describe("moneyByYear", () => {
  const years = new Map([
    ["d1", "1998"],
    ["d2", "1998"],
    ["d3", "2024"],
    ["undated", null]
  ]);

  it("totals the indicative euro value per year", () => {
    const m = moneyByYear(
      [
        amount({ documentId: "d1", value: 100000, currency: "BEF" }),
        amount({ documentId: "d2", value: 100000, currency: "BEF" }),
        amount({ documentId: "d3", value: 5000, currency: "EUR" })
      ],
      years
    );
    expect(m.get("1998")).toEqual({
      eur: 4957.88,
      amountCount: 2,
      unconvertibleCount: 0
    });
    expect(m.get("2024")!.eur).toBe(5000);
  });

  // A year whose money is all in dollars must not read as an empty year — that would be a bar of
  // zero where money exists.
  it("counts an unconvertible amount without letting it total to zero", () => {
    const m = moneyByYear(
      [amount({ documentId: "d1", value: 25000, currency: "USD" })],
      years
    );
    expect(m.get("1998")).toEqual({
      eur: null,
      amountCount: 1,
      unconvertibleCount: 1
    });
  });

  it("reports both when a year mixes convertible and floating currencies", () => {
    const m = moneyByYear(
      [
        amount({ documentId: "d1", value: 100000, currency: "BEF" }),
        amount({ documentId: "d2", value: 900, currency: "CHF" })
      ],
      years
    );
    expect(m.get("1998")).toEqual({
      eur: 2478.94,
      amountCount: 2,
      unconvertibleCount: 1
    });
  });

  it("ignores an amount whose document has no year", () => {
    const m = moneyByYear(
      [amount({ documentId: "undated", value: 1, currency: "EUR" })],
      years
    );
    expect(m.size).toBe(0);
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
