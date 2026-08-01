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

// ---------------------------------------------------------------------------------------------
// The registry: one row per date the file writes, and the controls that decide how many
// ---------------------------------------------------------------------------------------------

/**
 * The shape the registry needs from a fact, declared STRUCTURALLY rather than imported.
 *
 * Deliberate: this module is compiled against `@packages/types` as a built artefact in the test
 * runner and as source in the app, so importing a payload type that is still being added would make
 * these pure functions un-testable until an unrelated package is rebuilt. Structural typing keeps the
 * derivation honest — anything with these fields works, including the server's own payload type —
 * and keeps the lib compilable while the contract around it moves.
 */
export interface RegistryAmountLike {
  value: number;
  currency: string;
  /** How many separate documents state this figure beside this date. */
  documentCount: number;
}

export interface RegistryFactLike {
  /** ISO yyyy-mm-dd, written inside the documents. The spine of the whole view. */
  iso: string;
  /** How many separate documents state the date. The only weight available without reading. */
  documentCount: number;
  mentionCount?: number;
  /** Term ids found near the date. Words the file uses — never a qualification of the act. */
  notions?: readonly string[];
  qualifications?: readonly string[];
  milestones?: readonly string[];
  /** Literal exhibit references ("annexe 13"), never resolved to a document. */
  refs?: readonly string[];
  amounts?: readonly RegistryAmountLike[];
}

/**
 * The corroboration cuts the control bar offers, in the order it renders them.
 *
 * Descending, and starting at 5, because that is the reading order of the question: show me what
 * several filings agree on, then widen. Measured on the real corpus the cuts are 55 / 124 / 230 / 608
 * rows — the last one is the wall this view exists to replace, which is why it is offered last rather
 * than first.
 */
export const CORROBORATION_CUTS: readonly number[] = [5, 3, 2, 1];

export interface CorroborationCut {
  threshold: number;
  count: number;
  /** Facts the cut leaves out. Returned, not computed by the caller, because C8 requires a cap to
   *  state what it hid and a subtraction done at the call site is a subtraction that can be forgotten. */
  hidden: number;
}

export function countFactsByThreshold(
  facts: readonly RegistryFactLike[],
  thresholds: readonly number[] = CORROBORATION_CUTS
): CorroborationCut[] {
  return thresholds.map((threshold) => {
    const count = facts.reduce(
      (n, fact) => n + (fact.documentCount >= threshold ? 1 : 0),
      0
    );
    return { threshold, count, hidden: facts.length - count };
  });
}

/**
 * Thresholds tried, in order, when picking the cut the page opens on. Must be ascending.
 *
 * Separate from CORROBORATION_CUTS on purpose: the control bar is a fixed set of choices a reader
 * recognises, while this ladder exists to keep the OPENING view readable on a file ten times this
 * one's size. Today's corpus stops at the first rung.
 */
export const DEFAULT_THRESHOLD_LADDER: readonly number[] = [5, 6, 8, 10, 15];

/** Rows the opening view aims to stay under. Beyond this the ledger stops being readable. */
export const MAX_DEFAULT_ROWS = 120;

/**
 * The cut the page opens on: the LOWEST rung that keeps the table under the row budget.
 *
 * Lowest, not highest, because every rung climbed hides facts — so the default has to give away as
 * little as the budget allows, and whichever rung it lands on is printed in the control bar. When
 * even the top rung is over budget the top rung is returned anyway and the render cap takes over;
 * silently showing nothing would be worse than showing a stated prefix.
 */
export function chooseDefaultThreshold(
  facts: readonly RegistryFactLike[],
  ladder: readonly number[] = DEFAULT_THRESHOLD_LADDER,
  maxRows: number = MAX_DEFAULT_ROWS
): number {
  const rungs = ladder.length ? ladder : DEFAULT_THRESHOLD_LADDER;
  for (const threshold of rungs) {
    const count = facts.reduce(
      (n, fact) => n + (fact.documentCount >= threshold ? 1 : 0),
      0
    );
    if (count <= maxRows) return threshold;
  }
  return rungs[rungs.length - 1];
}

/** Rows rendered at once, whatever the cut. A backstop for a corpus this page has not seen yet. */
export const REGISTRY_RENDER_CAP = 300;

/** A capped list, and how many it left out — so the count cannot be dropped on the way to the UI. */
export function capRows<T>(
  rows: readonly T[],
  cap: number = REGISTRY_RENDER_CAP
): { rows: T[]; hidden: number } {
  return {
    rows: rows.slice(0, cap),
    hidden: Math.max(0, rows.length - cap)
  };
}

export interface FactFilter {
  /** Corroboration cut: keep facts stated by at least this many documents. */
  minDocuments?: number;
  /**
   * Term ids from any of the three vocabularies. A fact is kept when it carries ANY of them.
   *
   * ANY rather than ALL, and the reason is the control bar's own promise: chips show their count
   * within the current cut and a chip at zero is disabled, so that clicking one can never empty the
   * table. Intersection would break that promise — two chips with healthy counts can have no fact in
   * common — and an empty table reads as "nothing in the file", which would be a lie.
   */
  terms?: readonly string[];
  /** Four-digit year, from clicking a band on the chronology. */
  year?: string | null;
  requireAmount?: boolean;
  requireRef?: boolean;
}

function factTermIds(fact: RegistryFactLike): string[] {
  return [
    ...(fact.notions ?? []),
    ...(fact.qualifications ?? []),
    ...(fact.milestones ?? [])
  ];
}

export function filterFacts<T extends RegistryFactLike>(
  facts: readonly T[],
  filter: FactFilter = {}
): T[] {
  const wanted = filter.terms?.length ? new Set(filter.terms) : null;
  return facts.filter((fact) => {
    if (
      filter.minDocuments !== undefined &&
      fact.documentCount < filter.minDocuments
    )
      return false;
    if (filter.year && fact.iso.slice(0, 4) !== filter.year) return false;
    if (filter.requireAmount && !(fact.amounts?.length ?? 0)) return false;
    if (filter.requireRef && !(fact.refs?.length ?? 0)) return false;
    if (wanted && !factTermIds(fact).some((id) => wanted.has(id))) return false;
    return true;
  });
}

/**
 * How the registry is read.
 *
 * "chronological" is the DEFAULT, inverting what the earlier acts panel did. A ledger reads in time —
 * understanding a file that runs over twenty years is a reading task, not a ranking one — and the
 * count stays on every row for whoever wants the other question.
 */
export type FactOrder = "chronological" | "weight";

export function orderFacts<T extends RegistryFactLike>(
  facts: readonly T[],
  order: FactOrder
): T[] {
  const byWeight = (a: T, b: T) =>
    b.documentCount - a.documentCount ||
    (b.mentionCount ?? 0) - (a.mentionCount ?? 0) ||
    compareStrings(a.iso, b.iso);
  const byDate = (a: T, b: T) =>
    compareStrings(a.iso, b.iso) || b.documentCount - a.documentCount;
  return [...facts].sort(order === "weight" ? byWeight : byDate);
}

export interface TermCount {
  id: string;
  /** Facts carrying the term — NOT mentions. A word repeated in one filing is one fact, not five. */
  count: number;
}

/**
 * How many facts each term appears on, within whatever list is passed in.
 *
 * Pass `knownIds` — the full vocabulary — to get a zero row for terms the current cut does not
 * contain: a chip that renders disabled at "0" says the file is silent on that notion, which on this
 * corpus is a real finding ("quotité disponible" in 2 documents, the art. 918 trigger set in none).
 * A chip that simply vanishes says nothing at all.
 */
export function countTermsInFacts(
  facts: readonly RegistryFactLike[],
  knownIds?: readonly string[]
): TermCount[] {
  const counts = new Map<string, number>();
  if (knownIds) for (const id of knownIds) counts.set(id, 0);
  for (const fact of facts)
    for (const id of new Set(factTermIds(fact)))
      if (!knownIds || counts.has(id))
        counts.set(id, (counts.get(id) ?? 0) + 1);

  const rows = [...counts.entries()].map(([id, count]) => ({ id, count }));
  if (knownIds) {
    const order = new Map(knownIds.map((id, index) => [id, index]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return rows.sort((a, b) => b.count - a.count || compareStrings(a.id, b.id));
}

/**
 * The registry's facts as chronology items.
 *
 * The band's identity IS the date, which is what lets a click on a block scroll to the row that
 * states it. Note what changes by feeding the chronology from here rather than from the documents: a
 * 1996 purchase argued in a 2024 filing lands in 1996, where it happened, instead of in 2024, where
 * it was last mentioned.
 */
export function factsAsTimelineItems(
  facts: readonly RegistryFactLike[]
): TimelineItem[] {
  return facts.map((fact) => ({ id: fact.iso, date: fact.iso }));
}

// ---------------------------------------------------------------------------------------------
// Two figures for one date, a hair apart
// ---------------------------------------------------------------------------------------------

/** Below this a difference is bookkeeping — bank cents, a fee — not a disputed valuation. */
const DIVERGENCE_MIN_MAGNITUDE = 1000;
/** Two figures a rounding apart in the same currency are the same figure written twice. */
const DIVERGENCE_MIN_DELTA = 1;
/** Above this they are simply two different sums, and pairing them would assert a relationship. */
const DIVERGENCE_MAX_RELATIVE = 0.01;
/** One side must be corroborated, or this is one document's typo argued against itself. */
const DIVERGENCE_MIN_DOCUMENTS = 2;

export interface AmountDivergence<T extends RegistryAmountLike> {
  /** The better-corroborated figure. */
  primary: T;
  /** The one that differs. Rendered as "une pièce écrit …", with its own pin cite. */
  other: T;
}

/**
 * Figures stated for the same date that differ by less than a percent.
 *
 * This is the deterministic stand-in for the "disputed / undisputed" flag every case-management tool
 * sells and none of them derives: CaseMap makes it a manual dropdown, and the published state of the
 * art for finding it automatically is a multi-agent language model. What can be found without any
 * inference is ADJACENCY — 934.628 BEF in seven pièces against 934.623 BEF in one, on 24 June 1996 —
 * and that is worth showing with both excerpts and both pin cites, and no verdict whatsoever.
 *
 * THE RULE IS NARROW ON PURPOSE. The obvious version ("the same date carries two different amounts")
 * fires on 314 of 626 facts on the real corpus and is therefore noise. Same currency, same sign, both
 * sides of real size, at least a unit apart but under one percent, and one side stated by two or more
 * documents leaves three rows — which is why this renders inline in the amount cell and not as a
 * panel with a heading.
 *
 * It asserts nothing about which figure is right, and nothing about who wrote either.
 */
export function findNearIdenticalAmounts<T extends RegistryAmountLike>(
  amounts: readonly T[]
): AmountDivergence<T>[] {
  const pairs: AmountDivergence<T>[] = [];
  for (let i = 0; i < amounts.length; i++) {
    for (let j = i + 1; j < amounts.length; j++) {
      const a = amounts[i];
      const b = amounts[j];
      if (a.currency !== b.currency) continue;
      if (Math.sign(a.value) !== Math.sign(b.value)) continue;
      const magnitude = Math.max(Math.abs(a.value), Math.abs(b.value));
      if (
        Math.min(Math.abs(a.value), Math.abs(b.value)) <
        DIVERGENCE_MIN_MAGNITUDE
      )
        continue;
      const delta = Math.abs(a.value - b.value);
      if (delta < DIVERGENCE_MIN_DELTA) continue;
      if (delta / magnitude >= DIVERGENCE_MAX_RELATIVE) continue;
      if (Math.max(a.documentCount, b.documentCount) < DIVERGENCE_MIN_DOCUMENTS)
        continue;
      // Better corroborated leads; the other is the one the sentence calls out.
      const [primary, other] =
        b.documentCount > a.documentCount ||
        (b.documentCount === a.documentCount &&
          Math.abs(b.value) > Math.abs(a.value))
          ? [b, a]
          : [a, b];
      pairs.push({ primary, other });
    }
  }
  return pairs.sort(
    (x, y) =>
      y.primary.documentCount - x.primary.documentCount ||
      Math.abs(y.primary.value) - Math.abs(x.primary.value) ||
      compareStrings(x.primary.currency, y.primary.currency) ||
      x.other.value - y.other.value
  );
}

// ---------------------------------------------------------------------------------------------
// Out of the page and into the conclusions
// ---------------------------------------------------------------------------------------------

/** One line of the exposé: a date, the sentence that states it, and where to find it. */
export interface ExposeRow {
  iso: string;
  /** The document's own words. A substring, never a rewrite — that is what makes this citable. */
  excerpt: string;
  /** The pièce: a filename, or whatever the caller shows on screen for it. */
  source: string;
  page?: number | null;
}

/**
 * The visible rows as plain text, numbered, ready to paste into conclusions.
 *
 * This is the point of the page: art. 744 3° C. jud. requires conclusions to set out "les faits
 * pertinents" and to give, for each prétention, "les pièces invoquées et leur numérotation", and art.
 * 748bis makes the last set des conclusions de synthèse. So the useful artefact is exactly this — a
 * chronological list of dates, each with the document's own sentence and a pin cite — and the moyens
 * are hers to write around it.
 *
 * The numbering restarts at 1 and follows the order handed in, which is the order on screen, so a
 * line she quotes in a hearing and a row on the page are the same row. `header` is the caller's, and
 * must state the cut and any active filter: text copied out of a filtered table without saying it was
 * filtered is the one way this feature could mislead.
 */
export function buildExposeDesFaits(
  rows: readonly ExposeRow[],
  header?: string
): string {
  const lines = rows.map((row, index) => {
    const excerpt = row.excerpt.replace(/\s+/g, " ").trim();
    const cite =
      row.page != null ? `${row.source}, p. ${row.page}` : row.source;
    return `${index + 1} · ${row.iso} · « ${excerpt} » · ${cite}`;
  });
  return header ? [header, "", ...lines].join("\n") : lines.join("\n");
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

/**
 * The smallest "cited by at least N pieces" cut whose chronology still fits the chart.
 *
 * A fixed N would be a constant fitted to one file. Measured on the real corpus the cut matters
 * enormously — at N=2 the chronology is 49 bands and 2002px with a stack of 42 in 1998; at N=5 it is
 * 23 bands, 998px and a tallest stack of 12, which is what the chart is dimensioned for. On a smaller
 * file N=2 may already fit and raising it would hide the case.
 *
 * So the cut is searched rather than chosen: keep loosening until the chronology would overflow, then
 * step back. The caller MUST show what the cut hid — a chronology that quietly drops two thirds of
 * the dates it found is worse than one that admits the threshold it used.
 */
export interface ChronologyCut {
  /** Minimum number of documents a date must be stated in to appear. */
  minDocuments: number;
  /** Dates kept, and how many were left out at this cut. */
  kept: number;
  omitted: number;
}

export interface CutInput {
  iso: string;
  documentCount: number;
}

export function chooseChronologyCut(
  dates: readonly CutInput[],
  fits: (isoDates: readonly string[]) => boolean,
  maxMinDocuments = 12
): ChronologyCut {
  const total = dates.length;
  let chosen = maxMinDocuments;
  for (let min = 1; min <= maxMinDocuments; min++) {
    const kept = dates.filter((d) => d.documentCount >= min);
    if (fits(kept.map((d) => d.iso))) {
      chosen = min;
      break;
    }
  }
  const kept = dates.filter((d) => d.documentCount >= chosen).length;
  return { minDocuments: chosen, kept, omitted: total - kept };
}

/**
 * Whether a set of dates would render inside `maxWidth`, using the chart's own geometry.
 *
 * Duplicating the band and gap widths here would let the two drift, so the caller passes them; the
 * chart is the only place that knows how wide a band is.
 */
export function chronologyFits(
  isoDates: readonly string[],
  geometry: {
    bandWidth: number;
    gapWidth: number;
    maxWidth: number;
    minGapYears?: number;
  }
): boolean {
  const years = [...new Set(isoDates.map((iso) => iso.slice(0, 4)))].sort();
  if (years.length === 0) return true;
  const minGap = geometry.minGapYears ?? 2;
  let gaps = 0;
  for (let i = 1; i < years.length; i++)
    if (Number(years[i]) - Number(years[i - 1]) - 1 >= minGap) gaps++;
  return (
    years.length * geometry.bandWidth + gaps * geometry.gapWidth <=
    geometry.maxWidth
  );
}
