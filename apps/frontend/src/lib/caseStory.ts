// Pure derivations behind the Récit view: a proportional timeline, and what a file's stated amounts
// add up to.
//
// Separate from the component for the same reason as documentInsights.ts: this decides what a lawyer
// sees, so it has to be testable, and nothing here may reach ./api.
//
// Deterministic throughout — identical input, identical output, identical order. No clock, no
// randomness, explicit comparators.

import {
  isConvertible,
  toEurIndicative,
  type LexStoryAmount
} from "@packages/types";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Proportional timeline
// ---------------------------------------------------------------------------------------------

export interface TimelineItem {
  id: string;
  /** ISO date, already validated by the caller. */
  date: string;
}

/**
 * Groups items into YEAR BANDS, with runs of empty years collapsed into explicit markers.
 *
 * WHY YEARS, AND WHY NOT A CONTINUOUS AXIS. Measured on a real case file the documents fall into 16
 * distinct years across seven decades — 1 in 1958, then nothing until 1989, then clusters of 7, 8 and
 * 8. On a proportional axis the 1958 contract sits alone at the far left and forty-odd documents crush
 * into the right tenth, so neither the sequence nor the density is readable. Banding by year gives
 * every year that has documents the same width, stacks its documents so none can overlap whatever the
 * count, and states the elapsed time in the GAP MARKERS instead of in the spacing.
 *
 * That is a deliberate trade: the axis stops being linear in time, so the gaps have to say how long
 * they are — "1959-1988, 30 ans sans pièce" — or the chronology would be misread. Spacing that lies
 * quietly is worse than spacing that hands the number over.
 */
export interface YearBand<T> {
  year: string;
  /** The year's items, in date order then id, so the stack never reshuffles. */
  items: T[];
}

/** A run of years with no documents at all, sitting between two bands. */
export interface YearGapMarker {
  /** Index in `bands` this gap sits immediately BEFORE. */
  beforeIndex: number;
  fromYear: string;
  toYear: string;
  /** How many years are hidden. The UI renders this; the layout must not hide it. */
  years: number;
}

export interface YearBands<T> {
  bands: YearBand<T>[];
  gaps: YearGapMarker[];
  /** Items with no usable date — present so a caller cannot render bands and forget them. */
  undated: T[];
  /** The tallest band, so a caller can scale the stack to fit. */
  maxCount: number;
}

/** A run of empty years shorter than this is left as blank width rather than marked. */
const MIN_MARKED_GAP_YEARS = 2;

export function buildYearBands<T extends TimelineItem>(
  items: readonly T[]
): YearBands<T> {
  const byYear = new Map<string, T[]>();
  const undated: T[] = [];

  for (const item of items) {
    const match = /^(\d{4})-\d{2}-\d{2}$/.exec(item.date);
    if (!match || Number.isNaN(Date.parse(item.date))) {
      undated.push(item);
      continue;
    }
    const list = byYear.get(match[1]);
    if (list) list.push(item);
    else byYear.set(match[1], [item]);
  }

  const years = [...byYear.keys()].sort(compareStrings);
  const bands: YearBand<T>[] = years.map((year) => ({
    year,
    items: [...byYear.get(year)!].sort(
      (a, b) => compareStrings(a.date, b.date) || compareStrings(a.id, b.id)
    )
  }));

  const gaps: YearGapMarker[] = [];
  for (let i = 1; i < years.length; i++) {
    const missing = Number(years[i]) - Number(years[i - 1]) - 1;
    if (missing >= MIN_MARKED_GAP_YEARS) {
      gaps.push({
        beforeIndex: i,
        fromYear: String(Number(years[i - 1]) + 1),
        toYear: String(Number(years[i]) - 1),
        years: missing
      });
    }
  }

  return {
    bands,
    gaps,
    undated,
    maxCount: bands.reduce((max, band) => Math.max(max, band.items.length), 0)
  };
}

/**
 * Indicative euro value of the amounts stated in each year, so money is visible IN TIME rather than
 * only in a total.
 *
 * Unconvertible currencies are counted but contribute NOTHING to the euro figure, and the count is
 * returned so a year whose money is all in dollars reads as "3 montants, conversion indisponible"
 * instead of as an empty year. A bar of zero where money exists would be the worst of both.
 */
export interface YearMoney {
  eur: number | null;
  amountCount: number;
  unconvertibleCount: number;
}

export function moneyByYear(
  amounts: readonly LexStoryAmount[],
  yearOfDocument: ReadonlyMap<string, string | null>
): Map<string, YearMoney> {
  const byYear = new Map<string, YearMoney>();
  for (const amount of amounts) {
    const year = yearOfDocument.get(amount.documentId);
    if (!year) continue;
    const entry = byYear.get(year) ?? {
      eur: null,
      amountCount: 0,
      unconvertibleCount: 0
    };
    entry.amountCount += 1;
    const converted = toEurIndicative(amount.value, amount.currency);
    if (converted) entry.eur = (entry.eur ?? 0) + converted.value;
    else entry.unconvertibleCount += 1;
    byYear.set(year, entry);
  }
  for (const entry of byYear.values())
    if (entry.eur !== null) entry.eur = Math.round(entry.eur * 100) / 100;
  return byYear;
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

export interface CurrencyTotal {
  currency: string;
  /** Sum in the original currency. Always shown; this is what the documents say. */
  total: number;
  count: number;
  /** Indicative euro value, or null when the currency has no legally fixed rate. */
  eur: number | null;
}

export interface MoneySummary {
  byCurrency: CurrencyTotal[];
  /**
   * Indicative euro total of the CONVERTIBLE currencies only, or null when none are.
   * Never includes an unconvertible amount as zero — see unconvertible below.
   */
  convertibleEur: number | null;
  /** Currencies excluded from convertibleEur, and how many amounts each accounts for. */
  unconvertible: CurrencyTotal[];
  amountCount: number;
  documentCount: number;
}

/**
 * What a file's stated amounts add up to, per currency.
 *
 * Totals stay in their own currency first. The euro figure is secondary and INDICATIVE: the fixed
 * 1999 rates convert nominal amounts exactly but say nothing about present value, and they ignore
 * three decades of indexation.
 *
 * A currency with no fixed rate is reported SEPARATELY and never folded into the euro total. Counting
 * an unconvertible amount as zero would make a total that looks complete and is not, which is the one
 * failure mode a number a lawyer might rely on must not have.
 */
export function summariseMoney(
  amounts: readonly LexStoryAmount[]
): MoneySummary {
  const byCurrency = new Map<string, { total: number; count: number }>();
  const documents = new Set<string>();

  for (const amount of amounts) {
    documents.add(amount.documentId);
    const entry = byCurrency.get(amount.currency) ?? { total: 0, count: 0 };
    entry.total += amount.value;
    entry.count += 1;
    byCurrency.set(amount.currency, entry);
  }

  const totals: CurrencyTotal[] = [...byCurrency.entries()]
    .map(([currency, { total, count }]) => ({
      currency,
      total,
      count,
      eur: toEurIndicative(total, currency)?.value ?? null
    }))
    // Most amounts first — the currency the file is mostly written in leads.
    .sort(
      (a, b) => b.count - a.count || compareStrings(a.currency, b.currency)
    );

  const convertible = totals.filter((t) => isConvertible(t.currency));
  const unconvertible = totals.filter((t) => !isConvertible(t.currency));

  return {
    byCurrency: totals,
    convertibleEur: convertible.length
      ? Math.round(
          convertible.reduce((sum, t) => sum + (t.eur ?? 0), 0) * 100
        ) / 100
      : null,
    unconvertible,
    amountCount: amounts.length,
    documentCount: documents.size
  };
}

/** Amounts grouped by document, largest absolute value first within each. */
export function groupAmountsByDocument(
  amounts: readonly LexStoryAmount[]
): Map<string, LexStoryAmount[]> {
  const byDoc = new Map<string, LexStoryAmount[]>();
  for (const amount of amounts) {
    const list = byDoc.get(amount.documentId);
    if (list) list.push(amount);
    else byDoc.set(amount.documentId, [amount]);
  }
  for (const list of byDoc.values()) {
    list.sort(
      (a, b) =>
        Math.abs(b.value) - Math.abs(a.value) || a.charStart - b.charStart
    );
  }
  return byDoc;
}

/**
 * Formats an amount the way the document writes it: European grouping, and the currency code after.
 *
 * Deliberately not Intl.NumberFormat with a currency style — that renders BEF as "F" or "BEF" by
 * locale data we do not control, and would silently localise a figure that must read the same as the
 * filing it came from.
 */
export function formatAmount(value: number, currency: string): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.trunc(abs);
  const cents = Math.round((abs - whole) * 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = cents > 0 ? `,${String(cents).padStart(2, "0")}` : "";
  return `${negative ? "-" : ""}${grouped}${decimals} ${currency}`;
}

// ---------------------------------------------------------------------------------------------
// Making the money readable
// ---------------------------------------------------------------------------------------------

/** One distinct sum, and every place a document states it. */
export interface AmountGroup {
  value: number;
  currency: string;
  /** Every sighting, in document reading order. */
  occurrences: LexStoryAmount[];
  /** Pages it appears on, ascending and deduped. Null entries mean the page is unknown. */
  pages: number[];
}

/**
 * Collapses repeated statements of the SAME sum into one row.
 *
 * A brief restates a figure every time it argues about it: in the real corpus "12.991.800 BEF" appears
 * four times in one set of conclusions and "11.500.000 BEF" twice. Listing each sighting separately
 * makes a wall of near-identical rows that reads as forty different sums when it is ten — the opposite
 * of understanding the file. Grouped, the repetition becomes information: how often a figure is argued
 * over, and on which pages.
 */
export function groupIdenticalAmounts(
  amounts: readonly LexStoryAmount[]
): AmountGroup[] {
  const byValue = new Map<string, AmountGroup>();
  for (const amount of amounts) {
    const key = `${amount.currency}:${amount.value}`;
    const group = byValue.get(key);
    if (group) group.occurrences.push(amount);
    else
      byValue.set(key, {
        value: amount.value,
        currency: amount.currency,
        occurrences: [amount],
        pages: []
      });
  }
  const groups = [...byValue.values()];
  for (const group of groups) {
    group.occurrences.sort((a, b) => a.charStart - b.charStart);
    group.pages = [
      ...new Set(
        group.occurrences
          .map((o) => o.pageFrom)
          .filter((p): p is number => p !== null)
      )
    ].sort((a, b) => a - b);
  }
  // Largest first: in a dispute about money the big figures are what the argument is about.
  return groups.sort(
    (a, b) =>
      Math.abs(b.value) - Math.abs(a.value) ||
      compareStrings(a.currency, b.currency)
  );
}

/** A sum that more than one document states — the same transaction, argued in several places. */
export interface RecurringAmount {
  value: number;
  currency: string;
  documentIds: string[];
  /** Total sightings across all of them. */
  occurrenceCount: number;
  /** One excerpt per document, so the thread can be read without opening anything. */
  samples: LexStoryAmount[];
}

/**
 * Sums that appear in SEVERAL documents.
 *
 * This is the one narrative thread available without any inference, and it is the most useful thing on
 * the page: when a 1996 deed, a 2020 note and a 2024 set of conclusions all state 12.991.800 BEF, they
 * are discussing one transaction, and reading those three passages together is how the disagreement
 * becomes visible. A figure stated in only one document is a detail; a figure restated across a decade
 * of filings is the case.
 *
 * It asserts nothing about WHY they agree, and nothing about who paid — only that the same number
 * appears in each, with the sentence from each so the reader judges.
 */
export function findRecurringAmounts(
  amounts: readonly LexStoryAmount[],
  minDocuments = 2
): RecurringAmount[] {
  const byValue = new Map<
    string,
    { value: number; currency: string; byDoc: Map<string, LexStoryAmount[]> }
  >();
  for (const amount of amounts) {
    const key = `${amount.currency}:${amount.value}`;
    const entry = byValue.get(key) ?? {
      value: amount.value,
      currency: amount.currency,
      byDoc: new Map()
    };
    const list = entry.byDoc.get(amount.documentId) ?? [];
    list.push(amount);
    entry.byDoc.set(amount.documentId, list);
    byValue.set(key, entry);
  }

  return (
    [...byValue.values()]
      .filter((entry) => entry.byDoc.size >= minDocuments)
      .map((entry) => {
        const documentIds = [...entry.byDoc.keys()].sort(compareStrings);
        return {
          value: entry.value,
          currency: entry.currency,
          documentIds,
          occurrenceCount: [...entry.byDoc.values()].reduce(
            (n, list) => n + list.length,
            0
          ),
          // The earliest sighting in each document reads most like a statement of the fact.
          samples: documentIds.map(
            (id) =>
              [...entry.byDoc.get(id)!].sort(
                (a, b) => a.charStart - b.charStart
              )[0]
          )
        };
      })
      // Most documents first, then largest — how many filings argue a figure is the better signal.
      .sort(
        (a, b) =>
          b.documentIds.length - a.documentIds.length ||
          Math.abs(b.value) - Math.abs(a.value) ||
          compareStrings(a.currency, b.currency)
      )
  );
}
