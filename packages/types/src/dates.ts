// Reading dates out of the BODY of a legal document, deterministically.
//
// Distinct from a document's own filing date, and that distinction is the point. A 2024 set of
// conclusions describing a 1996 purchase and a 1998 death currently appears on a chronology only in
// 2024, so on a file spanning seven decades the actual legal facts are buried inside recent filings.
// The dates written in the text are where the case's factual spine actually lives.
//
// Nothing here is generated. Every date is a substring the document contains, returned with the exact
// offsets so a caller can quote the sentence around it.

/** A date written in a document's text. */
export interface DateMention {
  /** ISO yyyy-mm-dd. Always a real calendar date — an impossible one is not returned. */
  iso: string;
  /** The matched text exactly as written ("27 mai 1998", "15/6/98"). */
  raw: string;
  start: number;
  end: number;
  /**
   * True when the century was inferred from a two-digit year.
   *
   * "15/6/98" is 1998 or 2098; only one is possible in a real file, but the document did not say so.
   * A caller that presents an inferred date as certain is overstating what the text contains, so the
   * flag travels with it and the UI marks it.
   */
  yearInferred: boolean;
}

const FR_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12
};

const NL_MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12
};

const MONTHS: Record<string, number> = { ...FR_MONTHS, ...NL_MONTHS };

const MONTH_ALTERNATION = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * "27 mai 1998", "1er janvier 2020", "17 november 1997". Four-digit year only: a written-out month
 * with a two-digit year is vanishingly rare and allowing it would mostly match noise.
 */
const WRITTEN = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\d{1,2})(?:er|e|ste|de)?\\s+(${MONTH_ALTERNATION})\\s+((?:19|20)\\d{2})(?![\\p{L}\\p{N}])`,
  "giu"
);

/**
 * "27/05/1998", "15/6/98", "10.07.1958", "31-12-2024".
 *
 * DAY BEFORE MONTH, always. Belgian and Dutch filings write dd/mm without exception, and "5/6/98"
 * cannot be told apart from the American order by inspection — so the convention is applied and
 * stated rather than guessed per-date. A first component above 12 confirms it; one below is read the
 * same way, because a file that mixes conventions silently would be worse than one that declares
 * which it uses.
 */
const NUMERIC =
  /(?<![\p{L}\p{N}])(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?![\p{L}\p{N}])/gu;

/**
 * Fallback pivot, used only when the caller cannot say when the document was written.
 * Deliberately not derived from the clock: a chronology that changed meaning on New Year's Eve would
 * be a real defect.
 */
const CENTURY_PIVOT = 30;

/**
 * Resolves a two-digit year against the year the DOCUMENT was written.
 *
 * A document cites the past, not the future: a 1998 letter writing "36" means 1936, and a 2024
 * conclusion writing "98" means 1998. Resolving against the citing document is therefore both more
 * accurate and still fully deterministic — the reference is data, not a clock.
 *
 * Measured on a real corpus, a fixed pivot got this wrong in the visible way: it produced acts dated
 * 2036, 2037 and 2038 in a family file whose oldest deeds are from the 1920s and 30s. Dates in the
 * future are exactly the errors a chronology cannot afford, because they sort to the end and read as
 * upcoming deadlines.
 */
function resolveYear(
  raw: string,
  referenceYear?: number
): { year: number; inferred: boolean } {
  if (raw.length === 4) return { year: Number(raw), inferred: false };
  const two = Number(raw);
  if (referenceYear === undefined)
    return {
      year: two <= CENTURY_PIVOT ? 2000 + two : 1900 + two,
      inferred: true
    };
  // The most recent century that does not put the act after the document citing it.
  const candidates = [1900 + two, 2000 + two].filter((y) => y <= referenceYear);
  return {
    year: candidates.length ? Math.max(...candidates) : 1900 + two,
    inferred: true
  };
}

/** True only for a date that exists — 31 February is a parse artefact, not a date. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Earliest year a case file plausibly refers to. Below this, the match is a reference number. */
const MIN_YEAR = 1900;
/** Latest. A file may schedule a hearing years out, but not centuries. */
const MAX_YEAR = 2100;

/**
 * Every date written in `text`, in the order it appears, deduplicated by position.
 *
 * Overlapping matches are resolved in favour of the WRITTEN form: "17 novembre 1997" and a numeric
 * date inside the same span would otherwise both fire.
 */
export interface FindDatesOptions {
  /**
   * The year the document itself was written, used to resolve two-digit years. Omit only when it is
   * genuinely unknown — the fallback pivot is strictly worse.
   */
  referenceYear?: number;
}

export function findDates(
  text: string,
  options: FindDatesOptions = {}
): DateMention[] {
  const found: DateMention[] = [];

  WRITTEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WRITTEN.exec(text)) !== null) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = Number(match[3]);
    if (!month || !isRealDate(year, month, day)) continue;
    found.push({
      iso: iso(year, month, day),
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      yearInferred: false
    });
  }

  NUMERIC.lastIndex = 0;
  while ((match = NUMERIC.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    // A numeric date inside an already-matched written one is the same date twice.
    if (found.some((d) => start < d.end && d.start < end)) continue;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const { year, inferred } = resolveYear(match[3], options.referenceYear);
    if (year < MIN_YEAR || year > MAX_YEAR) continue;
    if (!isRealDate(year, month, day)) continue;
    found.push({
      iso: iso(year, month, day),
      raw: match[0],
      start,
      end,
      yearInferred: inferred
    });
  }

  return found.sort((a, b) => a.start - b.start);
}

/**
 * A POSIX pattern for Postgres, to shortlist chunks before scanning them.
 *
 * Deliberately a SUPERSET of findDates — a prefilter may read a row it did not need to, but must
 * never hide one. Same rule as the money scan.
 */
export function sqlDatePattern(): string {
  const months = Object.keys(MONTHS).join("|");
  return `[0-9]{1,2}[[:space:]]*(${months})[[:space:]]*(19|20)[0-9]{2}|[0-9]{1,2}[./-][0-9]{1,2}[./-]([0-9]{2}|[0-9]{4})`;
}
