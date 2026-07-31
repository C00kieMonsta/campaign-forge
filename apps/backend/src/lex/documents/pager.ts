// Builds the per-page index rows from what the parser already produced. Pure: no I/O, no model.
//
// The point of this module is that `buildFullText` computes exact per-page char ranges and then
// throws them away, leaving the overlapping 4000-char chunk as the finest addressable unit in the
// system. That is why pinning page 6 currently hands the model a chunk covering pages 4-8, and why
// a quote from page 8 gets filed as "p. 4". Page rows fix both by being addressable and exact.
//
// HONEST LABELS ARE THE RULE HERE. A .docx or an email arrives as a single text blob with no pages
// at all, so it is divided into sections labelled "§n" with page_number NULL — never a fabricated
// "p. 3". A citation that names a page the document does not have is worse than one that admits it
// is a section.

import { createHash } from "node:crypto";
import { normalizeForFingerprint } from "./chunker";

/** Where a row's boundaries came from, and therefore how much a citation may claim. */
export type PageOrigin = "page" | "sheet" | "section" | "approximate";

export interface PageRow {
  ordinal: number;
  /** The real page number; NULL for formats without pages. */
  pageNumber: number | null;
  pageLabel: string;
  pageOrigin: PageOrigin;
  charStart: number;
  charEnd: number;
  text: string;
  charCount: number;
  tokenCount: number;
  /** sha256 of the normalised text; null for text too short to identify. */
  textFingerprint: string | null;
  /** The text continues into the next row, so reading this one alone truncates a sentence. */
  continuesIntoNext: boolean;
}

interface PageRange {
  start: number;
  end: number;
}

/**
 * Sections are cut at roughly this size for formats with no intrinsic pages. Chosen well below the
 * chunker's 4000 so a section is a readable unit rather than a second chunking scheme.
 */
const SECTION_TARGET_CHARS = 3000;
/** Below this, text is too short to identify a duplicate by — a blank page would match a blank. */
const MIN_FINGERPRINT_CHARS = 200;
/** Mirrors the chunker's estimate; used only for reporting and budget arithmetic. */
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** sha256 of the normalised text, or null when the text is too short to be identifying. */
export function fingerprintOf(text: string): string | null {
  const normalized = normalizeForFingerprint(text);
  if (normalized.length < MIN_FINGERPRINT_CHARS) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * sha256 of the EXACT page text — the staleness detector for a citation's page anchor
 * (lex_citations.page_text_hash), mirroring what chunk_content_hash does for the chunk grain.
 *
 * Deliberately NOT `fingerprintOf`, whose two properties are both wrong for this job: it collapses
 * case, whitespace, quotes and dashes (so a page whose text materially changed in those respects
 * would still be judged unchanged and keep an anchor it no longer earns), and it returns null under
 * MIN_FINGERPRINT_CHARS (so a signature page or a short section could never be anchored at all).
 *
 * Any future writer of page-anchored citations MUST hash with this same function: the re-anchor
 * after a page-index rebuild compares against it, so a different hash silently drops every anchor.
 */
export function pageTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A stored chunk's anchor, as read back from lex_document_chunks. */
export interface IndexedSpan {
  chunkIndex: number;
  charStart: number | null;
  charEnd: number | null;
  content: string;
}

/**
 * Returns the first span that does not slice back out of `fullText`, or null when every one does.
 *
 * This is the gate on building a page index for a document that is ALREADY indexed. Page rows are
 * nothing but offsets into a fullText, so if the text re-derived today differs by one character from
 * the text the chunks were built against, the same quote resolves to different source through the
 * two grains — and which one answers depends on whether the document happens to be pinned. For a
 * tool whose output is filed in court that is not a tolerable ambiguity, so the re-derivation is
 * checked against the chunks rather than trusted.
 *
 * NULL offsets count as a mismatch: char_start/char_end are nullable, and a span that cannot be
 * checked has not been verified.
 */
export function firstSpanMismatch(
  fullText: string,
  spans: IndexedSpan[]
): IndexedSpan | null {
  for (const span of spans) {
    if (span.charStart === null || span.charEnd === null) return span;
    if (fullText.slice(span.charStart, span.charEnd) !== span.content) {
      return span;
    }
  }
  return null;
}

/**
 * Abbreviations whose trailing period is NOT a sentence end. Belgian filings are dense with them,
 * and "…conformément à l'art." / "374 du Code civil" split across two pages is a continuation that
 * a naive full-stop test would miss — leaving the article number stranded from its article.
 */
// The leading class must include the apostrophe: French elides ("l'art.", "d'al."), so a
// whitespace-only boundary misses the most common form in a Belgian filing.
const ABBREVIATIONS =
  /(?:^|[\s('’"«])(?:art|artt|cf|al|pp?|nr|no|vol|ch|par|§+|inc|jr|sr|etc|c\.?civ|resp|éd|ed|tw|nl|fr)\.$/i;

/**
 * True when `text` runs on into `next`.
 *
 * Deterministic and deliberately conservative: a page ending mid-clause, or a next page opening
 * lower-case, means the two must be read together. Used to pull neighbours into a read set, so a
 * false positive costs one extra page while a false negative costs a truncated clause — hence the
 * bias toward "true".
 *
 * A next page opening with a DIGIT is deliberately NOT treated as a continuation on its own: real
 * filings routinely start a page with a numbered heading ("3. Financement de la propriété"). It
 * only continues when the previous page ended on an abbreviation expecting a number.
 */
export function continuesInto(text: string, next: string | undefined): boolean {
  if (!next) return false;
  const tail = text.trimEnd();
  const head = next.trimStart();
  if (tail.length === 0 || head.length === 0) return false;

  if (ABBREVIATIONS.test(tail)) return true;

  const lastChar = tail[tail.length - 1];
  const endsSentence = ".!?:;»\"'".includes(lastChar);
  const nextStartsLower =
    head[0] === head[0].toLowerCase() && /\p{L}/u.test(head[0]);
  return !endsSentence || nextStartsLower;
}

/**
 * Splits one text blob into section ranges on paragraph boundaries.
 *
 * Used for formats the parser hands over as a single element (docx, email, html, txt, a voice-note
 * transcript). Boundaries snap to a blank line where one is near, so a section break lands between
 * paragraphs rather than mid-sentence.
 */
function sectionRanges(text: string, offset: number): PageRange[] {
  if (text.length <= SECTION_TARGET_CHARS) {
    return [{ start: offset, end: offset + text.length }];
  }
  const ranges: PageRange[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + SECTION_TARGET_CHARS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n\n", end);
      // Only snap backwards if it does not halve the section.
      if (boundary > at + SECTION_TARGET_CHARS / 2) end = boundary;
    }
    ranges.push({ start: offset + at, end: offset + end });
    at = end;
  }
  return ranges;
}

export interface BuildPagesOptions {
  /** How the parser produced `pages`, which decides the labels and whether page numbers exist. */
  kind: "page" | "sheet" | "blob";
  /** Sheet names, when kind is 'sheet'; index-aligned with the pages array. */
  sheetNames?: string[];
}

/**
 * Turns the parser's per-page array plus buildFullText's ranges into page rows.
 *
 * `pageRanges` is passed in rather than recomputed so the offsets are literally the ones the chunks
 * were built against — the two grains must agree or a citation resolved through one will not
 * resolve through the other.
 */
export function buildPageRows(
  fullText: string,
  pageRanges: PageRange[],
  options: BuildPagesOptions
): PageRow[] {
  // A single blob has no intrinsic pages: sub-divide it into honest sections instead.
  const useSections = options.kind === "blob" && pageRanges.length === 1;
  const ranges = useSections
    ? sectionRanges(
        fullText.slice(pageRanges[0].start, pageRanges[0].end),
        pageRanges[0].start
      )
    : pageRanges;

  const texts = ranges.map((r) => fullText.slice(r.start, r.end));

  return ranges.map((range, i) => {
    const text = texts[i];
    const origin: PageOrigin = useSections
      ? "section"
      : options.kind === "sheet"
        ? "sheet"
        : "page";
    const ordinal = i + 1;
    const label =
      origin === "sheet"
        ? `sheet: ${options.sheetNames?.[i] ?? ordinal}`
        : origin === "section"
          ? ranges.length === 1
            ? "whole document"
            : `§${ordinal}`
          : `p. ${ordinal}`;

    return {
      ordinal,
      // Only a real page gets a page number. A section that claimed one would be cited as a page.
      pageNumber: origin === "page" ? ordinal : null,
      pageLabel: label,
      pageOrigin: origin,
      charStart: range.start,
      charEnd: range.end,
      text,
      charCount: text.length,
      tokenCount: estimateTokens(text),
      textFingerprint: fingerprintOf(text),
      continuesIntoNext: continuesInto(text, texts[i + 1])
    };
  });
}

/**
 * The same invariant the chunker asserts, for pages: a row's [charStart,charEnd) must slice back to
 * exactly its stored text. Every page-anchored citation resolves through these offsets, so this is
 * checked before any row is written rather than trusted.
 */
export function assertPageRoundTrip(fullText: string, rows: PageRow[]): void {
  for (const row of rows) {
    if (fullText.slice(row.charStart, row.charEnd) !== row.text) {
      throw new Error(`page offset mismatch at ordinal ${row.ordinal}`);
    }
  }
}

/**
 * Locates a verbatim quote inside a page and returns its exact span, or null.
 *
 * Only a RAW hit yields offsets. A normalised match (whitespace-collapsed, case-folded) proves the
 * quote is present but its character positions in the original are unknown, so callers fall back to
 * the page's own span rather than computing a span that would deep-link to the wrong text.
 */
export function quoteSpanIn(
  pageText: string,
  quote: string
): { start: number; end: number } | null {
  const at = pageText.indexOf(quote);
  if (at < 0) return null;
  return { start: at, end: at + quote.length };
}
