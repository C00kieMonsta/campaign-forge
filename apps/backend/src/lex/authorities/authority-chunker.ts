// Article-aware chunking for AUTHORITIES — the law the user uploads (a code, a statute, a
// leading judgment). The sibling of documents/chunker.ts and deliberately built the same way:
// char offsets index into the reconstructed full text (see buildFullText), so
// `fullText.slice(charStart, charEnd) === chunk.content` holds exactly (round-trippable).
//
// WHY A SECOND CHUNKER instead of reusing chunkText: for a statute the citable anchor is the
// ARTICLE NUMBER, not the page. A page number belongs to one printing; "art. 374 C. civ." is
// what goes into a submission and what a judge verifies. So the split follows article headings
// rather than a fixed window — each article becomes its own chunk (an over-long one is split
// across several chunks that all carry the same label). That is what lets a retrieved passage
// name the article it came from, and what turns "what does article 374 say" into an exact
// lookup instead of a similarity search.

import { estimateTokens } from "../../shared/tokens";
import { buildFullText } from "../documents/chunker";

// The same window as documents/chunker.ts, and for the same reason (~1000 tokens with ~150
// tokens of overlap). Here it only ever applies INSIDE one over-long article: a normal article
// is far shorter than TARGET_CHARS and comes out as a single chunk.
const TARGET_CHARS = 4000;
const OVERLAP_CHARS = 600;
const MIN_SNAP_CHARS = 500;

/**
 * Read off buildFullText's return type instead of redeclared, so the page index this chunker
 * consumes can never drift from the one the document pipeline produces.
 */
type PageRange = ReturnType<typeof buildFullText>["pageRanges"][number];

export interface AuthorityChunk {
  chunkIndex: number;
  /** Canonical citation anchor ("Art. 374bis"); null for text before the first article. */
  articleLabel: string | null;
  content: string;
  charStart: number;
  charEnd: number;
  pageFrom: number;
  pageTo: number;
  tokenCount: number;
}

// The ordinal suffixes Belgian/French legislative drafting uses when an article is inserted
// after the fact ("374bis" sits between 374 and 375), plus "er" — the first article of a code
// is cited "Art. 1er", never "Art. 1".
const ORDINAL =
  "er|bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|undecies|duodecies";
// The three ways one article is numbered: 374, 374bis / 374 bis, and 374/1 (the Belgian form
// for an article added inside a chapter). A space is allowed before the ordinal because print
// editions set it either way, and both must fold to the same label.
const ARTICLE_NUMBER = `\\d{1,4}(?:[ \\t]?(?:${ORDINAL}))?(?:/\\d{1,3})?`;
/**
 * A heading is only recognised at the START OF A LINE. "conformément à l'article 374 du Code
 * civil" is a cross-reference inside prose, and treating it as a heading would cut the article
 * that contains it into pieces and file them under the wrong number — the exact failure mode a
 * citation cannot survive. FR ("Art."/"Article") and NL ("Artikel") both appear in Belgian codes,
 * often in the same bilingual PDF.
 */
const HEADING_SOURCE =
  `^[ \\t]*art(?:icle|ikel)?[ \\t]*\\.?[ \\t]*(${ARTICLE_NUMBER})` +
  `(?:[ \\t]*[-–—][ \\t]*(${ARTICLE_NUMBER}))?`;

/** The same shape, anchored at both ends, for canonicalising a label the caller supplies. */
const LABEL_SOURCE =
  `^[ \\t]*(?:art(?:icle|ikel)?[ \\t]*\\.?[ \\t]*)?(${ARTICLE_NUMBER})` +
  `(?:[ \\t]*[-–—][ \\t]*(${ARTICLE_NUMBER}))?[ \\t]*\\.?[ \\t]*$`;

interface Heading {
  start: number;
  label: string;
}

interface Segment {
  label: string | null;
  start: number;
  end: number;
}

/** "374 bis" → "374bis", "374BIS" → "374bis": one article, one label, whatever the typesetter did. */
function canonicalNumber(raw: string): string {
  return raw.replace(/[ \t]+/g, "").toLowerCase();
}

/**
 * "Art. 1382-1383" is one heading covering a RANGE of articles; "Art. 374 - 1. Le juge…" is
 * article 374 whose body happens to open with "1.". They are told apart by whether the second
 * number counts UP from the first, which is the only thing a range can do — so mislabelling
 * needs a genuinely malformed source, not merely an unlucky one.
 */
function isRange(first: string, second: string): boolean {
  return parseInt(second, 10) > parseInt(first, 10);
}

function labelFrom(first: string, second?: string): string {
  const head = canonicalNumber(first);
  return second && isRange(first, second)
    ? `Art. ${head}-${canonicalNumber(second)}`
    : `Art. ${head}`;
}

/**
 * Canonicalises whatever the caller has ("374", "art 374 bis", "Artikel 374/1", "Art. 1382-1383")
 * into the exact string stored in lex_authority_chunks.article_label, or null if it is not an
 * article reference at all.
 *
 * Both sides of an exact article lookup go through this one function, so a query can never miss
 * an article merely because it was written in the other language or without the "Art." prefix.
 * It is deliberately strict about trailing text ("Art. 374 du Code civil" → null): guessing which
 * of several numbers in a sentence is the citation is how the wrong article ends up quoted.
 */
export function normalizeArticleLabel(raw: string): string | null {
  const m = new RegExp(LABEL_SOURCE, "i").exec(raw);
  return m ? labelFrom(m[1], m[2]) : null;
}

/**
 * Drops the "Art. 374." heading from the front of a chunk's text.
 *
 * Used when building the digest's subject lines, where the label is carried separately and the
 * per-article budget is a few dozen characters — spending them on a number we already have is
 * the difference between a usable map line and a useless one.
 */
export function stripArticleHeading(content: string): string {
  const m = new RegExp(HEADING_SOURCE, "i").exec(content);
  if (!m) return content;
  // Also drop the separator print editions put between the number and the text.
  return content.slice(m[0].length).replace(/^[ \t]*[-–—.:§]*[ \t]*/, "");
}

function findHeadings(fullText: string): Heading[] {
  const re = new RegExp(HEADING_SOURCE, "gim");
  const out: Heading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    // m.index is the start of the LINE (the pattern opens with ^[ \t]*), so the heading itself
    // stays inside the chunk it introduces — retrieval and the model both need to see it.
    out.push({ start: m.index, label: labelFrom(m[1], m[2]) });
  }
  return out;
}

/** Mirrors chunker.ts's page lookup, which is module-private there. */
function pageForOffset(offset: number, pageRanges: PageRange[]): number {
  for (let i = 0; i < pageRanges.length; i++) {
    if (offset < pageRanges[i].end) return i + 1; // 1-based; also catches separator gaps
  }
  return pageRanges.length || 1;
}

/**
 * The [start,end) windows one article is stored as: one window when it fits, otherwise the same
 * snap-to-paragraph loop chunkText uses, bounded to the article so a window never carries text
 * from the next one (which would put a passage under the wrong article number).
 */
function* windowsOf(
  fullText: string,
  segStart: number,
  segEnd: number
): Generator<{ start: number; end: number }> {
  let start = segStart;
  while (start < segEnd) {
    let end = Math.min(start + TARGET_CHARS, segEnd);
    if (end < segEnd) {
      const boundary = fullText.lastIndexOf("\n\n", end);
      if (boundary > start + MIN_SNAP_CHARS) end = boundary;
    }
    yield { start, end };
    if (end >= segEnd) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
}

/** The article segments of the text, in reading order, covering it end to end. */
function segmentsOf(fullText: string, headings: Heading[]): Segment[] {
  const segments: Segment[] = [];
  const firstStart = headings.length ? headings[0].start : fullText.length;
  // Whatever precedes the first article — cover page, preamble, table of contents — is kept as
  // an unlabelled segment. Dropping it would make the authority's own title unsearchable.
  if (firstStart > 0) segments.push({ label: null, start: 0, end: firstStart });
  headings.forEach((h, i) => {
    segments.push({
      label: h.label,
      start: h.start,
      end: i + 1 < headings.length ? headings[i + 1].start : fullText.length
    });
  });
  return segments;
}

export function chunkAuthority(
  fullText: string,
  pageRanges: PageRange[]
): AuthorityChunk[] {
  const chunks: AuthorityChunk[] = [];
  let index = 0;

  for (const seg of segmentsOf(fullText, findHeadings(fullText))) {
    for (const w of windowsOf(fullText, seg.start, seg.end)) {
      const content = fullText.slice(w.start, w.end);
      if (content.trim().length === 0) continue;
      chunks.push({
        chunkIndex: index++,
        articleLabel: seg.label,
        content,
        charStart: w.start,
        charEnd: w.end,
        pageFrom: pageForOffset(w.start, pageRanges),
        pageTo: pageForOffset(Math.max(w.start, w.end - 1), pageRanges),
        tokenCount: estimateTokens(content)
      });
    }
  }

  return chunks;
}

/** Distinct articles detected — what lex_authorities.article_count reports to the user. */
export function countArticles(chunks: AuthorityChunk[]): number {
  return new Set(
    chunks
      .map((c) => c.articleLabel)
      .filter((label): label is string => label !== null)
  ).size;
}
