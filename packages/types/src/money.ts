// Reading monetary amounts out of legal text, deterministically.
//
// Lives in @packages/types because BOTH the backend (which scans stored chunk text) and the frontend
// (which totals and renders what the backend found) need exactly the same answer. Two
// implementations would eventually disagree about what counts as money, and the disagreement would
// show up as a total that does not match the rows beneath it.
//
// NOTHING HERE IS GENERATED OR INFERRED. Every amount is a substring of the document's own text, and
// the only judgement is arithmetic: which characters are digits, which are separators, which token
// names the currency. That is the whole point — a figure a lawyer may argue from must be traceable to
// characters someone typed, not to a model's reading of them.

/**
 * A currency the app can recognise in a filing.
 *
 * `fixedEurRate` is non-null ONLY where the rate is law rather than an estimate: the twelve
 * irrevocable rates fixed on 31 December 1998 when the euro replaced the legacy currencies. Those
 * are facts and converting with them states nothing new.
 *
 * A floating currency (USD, GBP, CHF …) has `fixedEurRate: null` and is NEVER converted. Picking a
 * historical rate for a 1994 dollar payment would be inventing a valuation — and in the disputes this
 * app serves, valuation is frequently the thing being argued about.
 *
 * ADDING A CURRENCY IS ONE ENTRY IN THIS ARRAY AND NOTHING ELSE. The scanning pattern, the SQL
 * prefilter and the parser all derive from it; a spec asserts that, so the claim cannot rot.
 */
export interface CurrencyDefinition {
  /** ISO 4217 code — the canonical form everything downstream stores and groups by. */
  code: string;
  /**
   * How filings actually write it, in French, Dutch and English. Matched case-insensitively, longest
   * first, so "BEF" is not shadowed by a shorter token that happens to prefix it.
   */
  tokens: string[];
  /** Units per euro, fixed by law. Null for a floating currency, which is never converted. */
  fixedEurRate: number | null;
}

export const CURRENCIES: readonly CurrencyDefinition[] = [
  { code: "EUR", tokens: ["EUR", "€", "euros", "euro"], fixedEurRate: 1 },
  // Belgium's own, and the one this corpus is full of. "FB" and "francs"/"frank" are how the
  // 1989-1998 acts write it; the ISO code barely appears in the documents themselves.
  {
    code: "BEF",
    tokens: [
      "BEF",
      "FB",
      "francs belges",
      "belgische frank",
      "francs",
      "frank"
    ],
    fixedEurRate: 40.3399
  },
  { code: "LUF", tokens: ["LUF"], fixedEurRate: 40.3399 },
  // "DM" and bare "mark" are deliberately absent: two letters and an ordinary word, both of
  // which matched inside unrelated text even with word boundaries applied.
  { code: "DEM", tokens: ["DEM", "deutsche mark"], fixedEurRate: 1.95583 },
  // "FF" is dropped for the same reason — two letters that occur constantly inside French words.
  { code: "FRF", tokens: ["FRF", "francs français"], fixedEurRate: 6.55957 },
  {
    code: "NLG",
    tokens: ["NLG", "gulden", "florins", "florin"],
    fixedEurRate: 2.20371
  },
  // "lire" is the French verb "to read"; only the plural is safe.
  { code: "ITL", tokens: ["ITL", "lires"], fixedEurRate: 1936.27 },
  { code: "ESP", tokens: ["ESP", "pesetas", "peseta"], fixedEurRate: 166.386 },
  {
    code: "ATS",
    tokens: ["ATS", "schillings", "schilling"],
    fixedEurRate: 13.7603
  },
  { code: "IEP", tokens: ["IEP"], fixedEurRate: 0.787564 },
  { code: "FIM", tokens: ["FIM"], fixedEurRate: 5.94573 },
  { code: "PTE", tokens: ["PTE", "escudos", "escudo"], fixedEurRate: 200.482 },
  { code: "GRD", tokens: ["GRD", "drachmes", "drachme"], fixedEurRate: 340.75 },
  // Floating: recognised so an amount in one is never silently read as euros, but never converted.
  {
    code: "USD",
    tokens: ["USD", "US$", "dollars", "dollar"],
    fixedEurRate: null
  },
  { code: "GBP", tokens: ["GBP", "£", "livres sterling"], fixedEurRate: null },
  { code: "CHF", tokens: ["CHF", "francs suisses"], fixedEurRate: null }
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyByCode(code: string): CurrencyDefinition | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** True when the currency has a legally fixed euro rate and may therefore be converted. */
export function isConvertible(code: string): boolean {
  return currencyByCode(code)?.fixedEurRate != null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every currency token, longest first so "francs belges" wins over "francs", and "US$" over "$".
 * Order matters for alternation: a regex alternation is first-match, not longest-match.
 */
const TOKENS: { token: string; code: string }[] = CURRENCIES.flatMap((c) =>
  c.tokens.map((token) => ({ token, code: c.code }))
).sort((a, b) => b.token.length - a.token.length);

/**
 * A number as filings write it: digit groups separated by '.', ',' or a space, optionally signed.
 * Deliberately permissive about WHICH separator — telling thousands from decimals is parseAmount's
 * job, because the answer depends on the whole string and not on a character class.
 *
 * A sign must be written AGAINST the digits: "-450 000" is negative, "- 450 000" is not. In filings a
 * hyphen followed by a space is a bullet or a dash far more often than a minus — the corpus has
 * "- 450 000 fb" as a list item under another amount — and reading one as a sign would invert the
 * figure, which in a ledger is worse than dropping it.
 *
 * The grouped form requires AT LEAST ONE group (`+`, not `*`). With `*` it also matched an ungrouped
 * number, and because regex alternation is first-match rather than longest-match it then stopped at
 * three digits: "francs 1998" produced the amount 199, which also slipped past the year guard below
 * because "199" is not year-shaped. Requiring a group sends plain digit runs to the second branch,
 * which is greedy and takes all four.
 */
const NUMBER =
  "-?\\d{1,3}(?:[ .,]\\d{3})+(?:[.,]\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?";

/**
 * Years, not money. A bare four-digit number in this range next to the word "francs" is far more
 * often a date than an amount, and a legal chronology is dense with both. Only applies to a number
 * with NO separator and NO decimals — "1.958" or "1958,00" are amounts.
 */
const YEAR_LIKE = /^\d{4}$/;
const YEAR_MIN = 1500;
const YEAR_MAX = 2100;

/** One monetary amount found in a piece of text, with where it was found. */
export interface AmountHit {
  /** The matched text exactly as it appears — this is what a UI should show as evidence. */
  raw: string;
  value: number;
  /** ISO code from the registry, never the document's own spelling. */
  currency: string;
  /** Index range of `raw` within the scanned text, so a caller can widen it to a sentence. */
  start: number;
  end: number;
}

/**
 * The scanning pattern, built from the registry so the two cannot drift.
 *
 * A currency token is REQUIRED, on either side of the number: without that, every article number,
 * docket reference and page number in a court file is an "amount". Requiring the token is what makes
 * the scan selective enough to be worth running — measured on a real corpus, it matches 456 of 12766
 * chunks rather than all of them.
 */
/**
 * A token wrapped so it cannot match inside a longer word.
 *
 * This is not a nicety. Without it, scanning the real corpus produced 29 987 "amounts" across 9 148
 * chunks — including 6 041 Deutsche Mark and 9 400 French francs in a Belgian family file — because
 * "Dem" matched "37 Demandeur", "FF" matched inside French words, and "lire" is the French verb "to
 * read". Every one of those would have been a fabricated figure in a view a lawyer argues from.
 * Symbols (€, £, US$) get no boundary: they are not letters and cannot be inside a word.
 *
 * THE BOUNDARIES ARE ASYMMETRIC, and each side is decided by a real form in the corpus:
 *  - trailing excludes letters AND DIGITS, because extracted text contains base64 blobs (embedded
 *    attachments) where "fB1", "frF1" and "itL29" look exactly like a currency followed by a number.
 *    A token butted against a digit is noise.
 *  - leading excludes only LETTERS, because "4.000.000BEF" — no space — is a genuine way filings
 *    write it, so a digit before the token must stay legal.
 */
function tokenAlternative(token: string): string {
  const escaped = escapeRegExp(token);
  const startsAlpha = /^\p{L}/u.test(token);
  const endsAlpha = /\p{L}$/u.test(token);
  return (
    (startsAlpha ? "(?<!\\p{L})" : "") +
    escaped +
    (endsAlpha ? "(?![\\p{L}\\p{N}])" : "")
  );
}

export function amountPattern(): RegExp {
  const tokens = TOKENS.map((t) => tokenAlternative(t.token)).join("|");
  // The lookbehind on the number-then-token branch keeps a reference number from being read as an
  // amount. A real line in the corpus is "Réf:210/767/961227/12/004/000 FB 214000": without it the
  // leftmost match is the docket's trailing "000 FB" — an amount of ZERO — and the genuine
  // "FB 214000" that follows is never reached. A digit or a slash before the number means it is part
  // of something longer, not the start of a sum.
  return new RegExp(
    `(?:(${tokens})\\s*(${NUMBER}))|(?:(?<![\\d/])(${NUMBER})\\s*(${tokens}))`,
    "giu"
  );
}

/**
 * Turns a written number into a value, or null when the string cannot be read with confidence.
 *
 * SEPARATOR DISAMBIGUATION, which is the whole difficulty. Belgian and Dutch typography use '.' or a
 * space for thousands and ',' for decimals; Anglo typography is the exact inverse. So the convention
 * has to be inferred from the string:
 *
 *  - both '.' and ',' present  → the LAST one is the decimal separator ("1.234,56", "1,234.56")
 *  - the same separator twice   → it is thousands, and there are no decimals ("4.000.000")
 *  - one separator, 1-2 digits after → decimal ("1,50")
 *  - one separator, exactly 3 digits after → THOUSANDS ("1.234" = 1234)
 *  - one separator, any other run  → decimal
 *
 * That fourth rule is the only genuinely ambiguous case, and it resolves to thousands for a concrete
 * reason rather than a coin flip: no currency in the registry has three minor digits, so "1.234" as
 * one-point-two-three-four cannot be a sum of money, while 1234 obviously can.
 */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-");
  // Spaces only ever group thousands; no notation uses one as a decimal point.
  const body = trimmed.replace(/^-/, "").replace(/\s/g, "");
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;

  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  let decimalSeparator: "." | "," | null = null;
  if (dots > 0 && commas > 0) {
    decimalSeparator =
      body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
  } else if (dots + commas === 1) {
    const sep = dots === 1 ? "." : ",";
    const after = body.length - body.lastIndexOf(sep) - 1;
    // Exactly three digits after a lone separator: thousands, per the note above.
    decimalSeparator = after === 3 ? null : sep;
  } // dots + commas > 1 with only one kind → thousands grouping, no decimals.

  let normalized: string;
  if (decimalSeparator === null) {
    normalized = body.replace(/[.,]/g, "");
  } else {
    const other = decimalSeparator === "." ? "," : ".";
    normalized = body.split(other).join("").replace(decimalSeparator, ".");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Every amount in `text`, in the order it appears. */
export function findAmounts(text: string): AmountHit[] {
  const pattern = amountPattern();
  const hits: AmountHit[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // Groups 1-2 are token-then-number; 3-4 are number-then-token.
    const token = match[1] ?? match[4];
    const numeric = match[2] ?? match[3];
    if (!token || !numeric) continue;

    const bare = numeric.replace(/\s/g, "");
    if (YEAR_LIKE.test(bare)) {
      const asYear = Number(bare);
      if (asYear >= YEAR_MIN && asYear <= YEAR_MAX) continue;
    }

    const value = parseAmount(numeric);
    if (value === null) continue;
    const code = TOKENS.find(
      (t) => t.token.toLowerCase() === token.toLowerCase()
    )?.code;
    if (!code) continue;

    hits.push({
      raw: match[0],
      value,
      currency: code,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return hits;
}

/** A converted value, and the basis on which it was converted. */
export interface EurConversion {
  value: number;
  rate: number;
  /** Only ever 'fixed'. There is no other basis, and there will not be one without a decision. */
  basis: "fixed";
}

/**
 * The euro value of an amount, or null when the currency floats.
 *
 * Named `toEurIndicative`, not `toEur`, so no call site can read it as an authoritative valuation.
 * The fixed rates are exact conversions of nominal amounts and nothing more: they say what 4.000.000
 * BEF was called in euros in 1999, not what it is worth today, and they ignore three decades of
 * indexation. Every surface that shows the result has to say so.
 */
export function toEurIndicative(
  value: number,
  code: string
): EurConversion | null {
  const rate = currencyByCode(code)?.fixedEurRate;
  if (rate == null) return null;
  // Cents, because the output is only ever a subtotal or a chart axis; the exact original sits
  // beside it.
  return {
    value: Math.round((value / rate) * 100) / 100,
    rate,
    basis: "fixed"
  };
}

/**
 * A POSIX regex for Postgres's `~*`, generated from the same registry as amountPattern.
 *
 * The backend uses this to shortlist chunks before scanning them in JS, so it only has to avoid
 * reading rows that certainly contain no money — any row it lets through is re-checked by
 * findAmounts. Being generated from the registry is what stops it from quietly excluding a currency
 * the parser would have understood.
 *
 * It needs a boundary for the same reason amountPattern does — unbounded, it selected more than 2500
 * chunks on a 122-document workspace and tripped the read cap, truncating the ledger. But it uses
 * only Postgres's END-of-word marker (\M), not \y on both sides: POSIX has no lookbehind, and a
 * leading \y would reject the genuine "4.000.000BEF" form because a digit and a letter are both word
 * characters. One-sided keeps this a SUPERSET of what the scanner accepts, which is the property that
 * matters — a prefilter may read a row it did not need to, but must never hide one.
 */
export function sqlAmountPattern(): string {
  const tokens = TOKENS.map((t) => {
    const escaped = t.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `${escaped}${/\p{L}$/u.test(t.token) ? "\\M" : ""}`;
  }).join("|");
  return `(${tokens})[[:space:]]*[0-9]|[0-9][[:space:]]*(${tokens})`;
}
