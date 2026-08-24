// Chunks document text into overlapping windows, preserving the exact char offsets and
// page range for each chunk — these are the anchors a citation later resolves to. Offsets
// index into the reconstructed full text (see buildFullText), so
// `fullText.slice(charStart, charEnd) === chunk.content` holds exactly (round-trippable).

import { estimateTokens } from "../../shared/tokens";

const PAGE_SEPARATOR = "\n\n";
// ~1200 tokens target / ~175 token overlap at the shared CHARS_PER_TOKEN estimate.
const TARGET_CHARS = 4000;
const OVERLAP_CHARS = 600;
const MIN_SNAP_CHARS = 500;

export interface Chunk {
  chunkIndex: number;
  content: string;
  charStart: number;
  charEnd: number;
  pageFrom: number;
  pageTo: number;
  tokenCount: number;
}

interface PageRange {
  start: number;
  end: number;
}

/** Concatenates per-page text and records each page's [start,end) range in the full text. */
export function buildFullText(pages: string[]): {
  fullText: string;
  pageRanges: PageRange[];
} {
  let fullText = "";
  const pageRanges: PageRange[] = [];
  pages.forEach((page, i) => {
    const start = fullText.length;
    fullText += page;
    pageRanges.push({ start, end: fullText.length });
    if (i < pages.length - 1) fullText += PAGE_SEPARATOR;
  });
  return { fullText, pageRanges };
}

function pageForOffset(offset: number, pageRanges: PageRange[]): number {
  for (let i = 0; i < pageRanges.length; i++) {
    if (offset < pageRanges[i].end) return i + 1; // 1-based; also catches separator gaps
  }
  return pageRanges.length || 1;
}

/**
 * A content fingerprint of a document's extracted text, used to spot the same filing arriving
 * twice with different bytes — re-scanned, re-exported, or downloaded again from a portal.
 *
 * Normalisation is deliberately aggressive (case-folded, all whitespace collapsed, punctuation
 * that OCR commonly mangles removed) because those are exactly the differences between two
 * captures of one document. It is NOT a similarity score: two documents either normalise to the
 * same text or they do not, which keeps the "is this a duplicate" decision explainable — the
 * right property for a tool whose output is filed in court.
 */
export function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The only control characters that carry meaning in extracted text: tab, the two newline
 * forms, and the form feed a PDF text layer uses as a page/section break. */
const STRUCTURAL_WHITESPACE = new Set(["\t", "\n", "\r", "\f"]);

/**
 * Removes the characters Postgres refuses to store in a text column, plus the control
 * characters that only ever reach us from mis-decoded bytes.
 *
 * WHY it lives here, next to normalizeForFingerprint: both are pure, pre-chunk text
 * normalisations, and this one MUST run before buildFullText/chunkText. Sanitising after
 * chunking would shift the text under the already-stored char offsets and break
 * `fullText.slice(charStart, charEnd) === content` — the invariant every citation deep-link
 * resolves through.
 *
 * NUL is the hard failure, not a nicety: `invalid byte sequence for encoding "UTF8": 0x00`
 * aborts the INSERT, which is how three documents of a real 65-file court bundle died mid-bulk
 * upload. Unpaired surrogates go too — they cannot be encoded to UTF-8 at all, so the driver
 * would quietly substitute U+FFFD on the wire. \t, \n, \r and \f are kept: \f is a genuine
 * page/section break in extracted PDF text.
 */
export function sanitizeForStorage(text: string): string {
  return (
    text
      // The `u` flag makes this code-point-based, so a well-formed pair is one astral code
      // point (not in Cs) and only genuinely unpaired halves match.
      .replace(/\p{Cs}/gu, "")
      // \p{Cc} is exactly the C0 + C1 control blocks (U+0000–U+001F, U+007F–U+009F), written as
      // a property so the pattern holds no literal control characters of its own.
      .replace(/\p{Cc}/gu, (control) =>
        STRUCTURAL_WHITESPACE.has(control) ? control : ""
      )
  );
}

/**
 * Rebuilds document text from its stored chunks. Chunks overlap by OVERLAP_CHARS, so they cannot
 * simply be concatenated — the char offsets are used to append only the part of each chunk that
 * the previous ones did not already cover.
 *
 * This lets steps that need the whole text again (re-summarizing an already-ingested document)
 * skip re-downloading from S3 and, more importantly, skip paying for OCR or transcription twice.
 * Whitespace-only windows are dropped at chunk time, so a run of blank space between two chunks
 * is not restored — immaterial for summarization, which is the only consumer.
 */
export function stitchChunks(
  chunks: { content: string; charStart: number; charEnd: number }[]
): string {
  const ordered = [...chunks].sort((a, b) => a.charStart - b.charStart);
  let text = "";
  let cursor = 0;
  for (const chunk of ordered) {
    if (chunk.charEnd <= cursor) continue; // wholly covered by earlier chunks
    const skip = Math.max(0, cursor - chunk.charStart);
    text += chunk.content.slice(skip);
    cursor = chunk.charEnd;
  }
  return text;
}

export function chunkText(fullText: string, pageRanges: PageRange[]): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < fullText.length) {
    let end = Math.min(start + TARGET_CHARS, fullText.length);

    // Snap the window end back to a paragraph boundary when one is reasonably close, so we
    // don't split mid-sentence. Never snap before MIN_SNAP_CHARS of content.
    if (end < fullText.length) {
      const boundary = fullText.lastIndexOf("\n\n", end);
      if (boundary > start + MIN_SNAP_CHARS) end = boundary;
    }

    const content = fullText.slice(start, end);
    if (content.trim().length > 0) {
      chunks.push({
        chunkIndex: index++,
        content,
        charStart: start,
        charEnd: end,
        pageFrom: pageForOffset(start, pageRanges),
        pageTo: pageForOffset(Math.max(start, end - 1), pageRanges),
        tokenCount: estimateTokens(content)
      });
    }

    if (end >= fullText.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }

  return chunks;
}
