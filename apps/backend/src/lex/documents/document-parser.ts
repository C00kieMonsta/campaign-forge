// Text extraction for every shape a court file arrives in. Two rules were learned the hard way
// from a real 65-document folder upload:
//
//  1. FILENAMES LIE. A ".docx" in that bundle was a PDF; another was a renamed legacy .doc.
//     So the BYTES pick the parser (see sniffMagicBytes) and the extension only breaks ties.
//  2. A file we cannot read must FAIL with an explanation. The old catch-all
//     `buffer.toString("utf8")` swallowed binaries and produced NUL-laced pseudo-text that
//     Postgres rejected on INSERT (`invalid byte sequence for encoding "UTF8": 0x00`) — and
//     when it did insert, it poisoned the retrieval index with binary noise. Garbage text is
//     worse than a failed document: the lawyer can re-export a failure, but cannot see that a
//     "ready" document contains nonsense.

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";
import { sanitizeForStorage } from "./chunker";

export interface ParsedDocument {
  /** Text per page (PDF) / per sheet (XLSX); a single element otherwise. */
  pages: string[];
  pageCount: number;
  /** True when no text layer was found (scanned PDF or an image) → route to OCR. */
  needsOcr: boolean;
  /** True for voice notes → route to speech-to-text. */
  needsTranscription: boolean;
  /**
   * Characters sanitizeForStorage had to remove (NULs, stray control bytes). Reported so the
   * worker can log which documents needed it — that count is the fingerprint of the bug that
   * killed three documents of the first real bundle.
   */
  droppedChars: number;
  /**
   * What the `pages` array actually is, so the page index can label rows honestly.
   * The parser is the only place that knows: routing is by MAGIC BYTES, so a file named .docx can
   * be a real multi-page PDF and the filename cannot be trusted to decide this.
   */
  pageKind: "page" | "sheet" | "blob";
  /** Sheet names, index-aligned with `pages`, when pageKind is 'sheet'. */
  sheetNames?: string[];
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|tiff?|bmp)$/i;
const XLSX_RE = /\.(xlsx|xlsm|xlsb|xls)$/i;
const AUDIO_RE = /\.(webm|m4a|mp3|mp4|mpga|mpeg|wav|ogg|oga|opus|flac|aac)$/i;
const DOCX_RE = /\.docx$/i;
const LEGACY_DOC_RE = /\.(doc|dot)$/i;
const OUTLOOK_MSG_RE = /\.msg$/i;
const EMAIL_RE = /\.eml$/i;
const HTML_RE = /\.(html?|xhtml)$/i;
const TEXT_RE =
  /\.(txt|text|md|markdown|csv|tsv|json|jsonl|log|ya?ml|xml|rtf|vtt|srt|ini|cfg)$/i;

// Binary sniffing: enough head bytes to catch a container header, and the share of control
// bytes above which a file is not prose. Real text sits at ~0%; binaries are well above 10%.
const BINARY_SNIFF_BYTES = 8192;
const BINARY_CONTROL_RATIO = 0.1;
const BINARY_RATIO_MIN_BYTES = 64;
// The PDF spec tolerates junk before %PDF- and so do readers, so scan the head instead of
// demanding offset 0 — mail gateways and portals do prepend bytes.
const PDF_HEADER_SCAN_BYTES = 1024;
const MAX_MIME_DEPTH = 8;

/** True for a voice note / any audio document (its text comes from transcription). */
export function isAudio(contentType: string, filename: string): boolean {
  return (
    (contentType || "").toLowerCase().startsWith("audio/") ||
    AUDIO_RE.test(filename.toLowerCase())
  );
}

// ── Byte sniffing ─────────────────────────────────────────────────────────────────────────

export type SniffedType =
  | "pdf"
  | "zip"
  | "ole2"
  | "png"
  | "jpeg"
  | "gif"
  | "tiff"
  | "bmp"
  | "webp";

const IMAGE_SNIFFS: ReadonlySet<SniffedType> = new Set<SniffedType>([
  "png",
  "jpeg",
  "gif",
  "tiff",
  "bmp",
  "webp"
]);

function hasBytes(buffer: Buffer, offset: number, bytes: number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("latin1");
}

/**
 * Identifies the container from its magic bytes, or null when nothing is recognised.
 *
 * This is the load-bearing fix for the mislabelled files in the bundle: the extension is a
 * user-supplied string that survives renames, copies and mail round-trips, while these bytes
 * are written by the producing application.
 */
export function sniffMagicBytes(buffer: Buffer): SniffedType | null {
  if (buffer.length < 4) return null;
  if (hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "png";
  if (hasBytes(buffer, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  const head6 = ascii(buffer, 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return "gif";
  if (
    hasBytes(buffer, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    hasBytes(buffer, 0, [0x4d, 0x4d, 0x00, 0x2a])
  )
    return "tiff";
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP")
    return "webp";
  // "BM" alone is two ASCII letters that any sentence could start with, so also require the
  // BMP header's own size field to agree with the file — otherwise a text file wins.
  if (
    ascii(buffer, 0, 2) === "BM" &&
    buffer.length >= 6 &&
    buffer.readUInt32LE(2) === buffer.length
  )
    return "bmp";
  if (
    hasBytes(buffer, 0, [0x50, 0x4b, 0x03, 0x04]) ||
    hasBytes(buffer, 0, [0x50, 0x4b, 0x05, 0x06]) ||
    hasBytes(buffer, 0, [0x50, 0x4b, 0x07, 0x08])
  )
    return "zip";
  // OLE2/CFB: the pre-2007 Office container (.doc, .xls, .msg).
  if (hasBytes(buffer, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "ole2";
  if (buffer.subarray(0, PDF_HEADER_SCAN_BYTES).indexOf("%PDF-") >= 0)
    return "pdf";
  return null;
}

/**
 * True when the bytes are not text in any encoding we can read.
 *
 * NUL in the head is the classic signal (git uses the same one). The control-byte ratio catches
 * the binaries that happen to have no NUL early on. Bytes >= 0x80 are deliberately NOT counted:
 * they are ordinary in UTF-8 and in the Windows codepages these files come from.
 */
export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  // A BOM means real text — a Windows "Unicode" .txt is full of NULs and must not be condemned.
  if (bomEncodingOf(buffer)) return false;
  const sample = buffer.subarray(0, BINARY_SNIFF_BYTES);
  if (sample.includes(0)) return true;
  // Below this the ratio is noise: in a 20-byte file a single stray control byte is 5% on its
  // own, and condemning a short note as binary would be worse than sanitising it.
  if (sample.length < BINARY_RATIO_MIN_BYTES) return false;
  let control = 0;
  for (const byte of sample) {
    const isPrintableWhitespace = byte >= 0x09 && byte <= 0x0d;
    if ((byte < 0x20 && !isPrintableWhitespace) || byte === 0x7f) control++;
  }
  return control / sample.length > BINARY_CONTROL_RATIO;
}

// ── Text decoding ─────────────────────────────────────────────────────────────────────────

// windows-1252's 0x80–0x9F block, the only range where it differs from latin1. Outlook and
// Word write smart quotes, dashes and ellipses here; a plain latin1 decode would turn them into
// C1 control characters that sanitizeForStorage then deletes — silently eating the apostrophe
// out of French legal prose ("l'article" → "larticle"). 0xFFFD marks the five unassigned slots.
// Hand-rolled rather than TextDecoder("windows-1252") because that needs a full-ICU Node build,
// which the EC2 runtime does not guarantee.
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0xfffd, 0x017e, 0x0178
];

const CP1252_CHARSETS: ReadonlySet<string> = new Set([
  "iso-8859-1",
  "iso8859-1",
  "iso_8859-1",
  "latin1",
  "l1",
  "cp1252",
  "windows-1252",
  "win-1252",
  "ansi"
]);

function bomEncodingOf(buffer: Buffer): "utf8" | "utf16le" | "utf16be" | null {
  if (hasBytes(buffer, 0, [0xef, 0xbb, 0xbf])) return "utf8";
  if (hasBytes(buffer, 0, [0xff, 0xfe])) return "utf16le";
  if (hasBytes(buffer, 0, [0xfe, 0xff])) return "utf16be";
  return null;
}

/** Big-endian UTF-16 → string. Copies first: swap16 mutates in place, and the caller's Buffer
 * is the S3 body that markIfDuplicate later hashes. */
function decodeUtf16Be(buffer: Buffer): string {
  const even =
    buffer.length % 2 === 0 ? buffer : buffer.subarray(0, buffer.length - 1);
  return Buffer.from(Uint8Array.from(even)).swap16().toString("utf16le");
}

function decodeCp1252(buffer: Buffer): string {
  return buffer
    .toString("latin1")
    .replace(/[\u0080-\u009F]/g, (char) =>
      String.fromCodePoint(CP1252_HIGH[char.charCodeAt(0) - 0x80])
    );
}

/**
 * Decodes text bytes without ever producing mojibake silently: a BOM is honoured, then strict
 * UTF-8 is attempted, and only a *failed* strict decode falls back to windows-1252.
 *
 * Strict (fatal) decoding is the point. A lenient utf8 decode of a windows-1252 file returns a
 * string peppered with U+FFFD, which looks like successful extraction and lands in the index as
 * unsearchable noise; throwing lets us pick the encoding these files actually use.
 */
export function decodeText(buffer: Buffer): string {
  switch (bomEncodingOf(buffer)) {
    case "utf8":
      return buffer.subarray(3).toString("utf8");
    case "utf16le":
      return buffer.subarray(2).toString("utf16le");
    case "utf16be":
      return decodeUtf16Be(buffer.subarray(2));
    default:
      break;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return decodeCp1252(buffer);
  }
}

// ── Email (.eml / message/rfc822) ─────────────────────────────────────────────────────────
//
// A hand-rolled MIME-lite reader rather than a dependency: what we need from an email is its
// headers and its human-readable body, which is a few hundred lines of well-specified parsing.
// A full MIME library would also hand us attachment payloads — the one thing that must NOT
// reach the index, since base64 blobs are both enormous and meaningless to retrieval.

/** One readable body part, tagged with the MIME type it came from so multipart/alternative can
 * later choose the plain-text twin over the HTML one. */
interface EmailText {
  mime: string;
  text: string;
}

interface EmailContent {
  texts: EmailText[];
  /** Attachment FILENAMES only — see collectMimeParts. */
  attachments: string[];
}

const HEADER_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["Subject", "subject"],
  ["From", "from"],
  ["To", "to"],
  ["Cc", "cc"],
  ["Date", "date"]
];

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1
    ? trimmed.slice(1, -1)
    : trimmed;
}

/**
 * Reads a `; name=value` parameter out of a header. Splitting on ";" mis-handles a quoted value
 * that itself contains a semicolon; that is accepted, because the only cost is a truncated
 * attachment filename in the header block, never a mis-parsed body.
 */
function paramOf(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(";").slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    if (segment.slice(0, eq).trim().toLowerCase() !== name) continue;
    const value = unquote(segment.slice(eq + 1));
    if (value.length > 0) return value;
  }
  return undefined;
}

/** Splits a message (or a MIME part) into unfolded headers and its raw body. */
function splitMimeMessage(raw: string): {
  headers: Map<string, string>;
  body: string;
} {
  const blank = raw.search(/\r?\n\r?\n/);
  const headerBlock = blank === -1 ? raw : raw.slice(0, blank);
  const body = blank === -1 ? "" : raw.slice(blank).replace(/^\r?\n\r?\n/, "");
  const headers = new Map<string, string>();
  // RFC 5322 folding: a line starting with space/tab continues the header above it.
  for (const line of headerBlock.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    // First occurrence wins: Received/DKIM headers repeat, and the first is the outermost.
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return { headers, body };
}

/**
 * Splits a multipart body on its boundary. Line-based on purpose: a boundary delimiter is a
 * whole line, so matching lines cannot be confused by the same string appearing inside base64
 * or inside a nested part's own (different) boundary.
 */
function splitOnBoundary(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | null = null; // null until the first delimiter → preamble is dropped
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed === marker) {
      if (current) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    if (trimmed === `${marker}--`) {
      if (current) parts.push(current.join("\n"));
      current = null;
      break; // epilogue after the closing delimiter is not part of the message
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join("\n"));
  return parts;
}

function decodeQuotedPrintable(text: string): Buffer {
  const bytes: number[] = [];
  const hard = text.replace(/=\r?\n/g, ""); // soft line breaks carry no data
  for (let i = 0; i < hard.length; i++) {
    const pair = hard.slice(i + 1, i + 3);
    if (hard[i] === "=" && /^[0-9a-f]{2}$/i.test(pair)) {
      bytes.push(parseInt(pair, 16));
      i += 2;
      continue;
    }
    bytes.push(hard.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodeTransferEncoding(
  body: string,
  headers: Map<string, string>
): Buffer {
  const encoding = (headers.get("content-transfer-encoding") ?? "")
    .trim()
    .toLowerCase();
  if (encoding === "base64")
    return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  // 7bit / 8bit / binary / absent: the part is its own bytes, held 1:1 by the latin1 string.
  return Buffer.from(body, "latin1");
}

function decodeCharset(bytes: Buffer, charset?: string): string {
  const name = unquote((charset ?? "").toLowerCase());
  if (name.includes("utf-16") || name.includes("utf16")) {
    if (bomEncodingOf(bytes)) return decodeText(bytes);
    return name.includes("be")
      ? decodeUtf16Be(bytes)
      : bytes.toString("utf16le");
  }
  if (CP1252_CHARSETS.has(name)) return decodeCp1252(bytes);
  return decodeText(bytes); // utf-8, with the windows-1252 fallback for a lying charset label
}

/**
 * Header text, decoded twice over.
 *
 * The message was read as latin1 (one char per byte), so a header carrying RAW utf-8 — which
 * plenty of mail clients emit despite RFC 5322 saying headers are ASCII — arrives as mojibake
 * ("ConfrÃ¨re"). Re-reading those bytes with decodeText fixes it, and only then are RFC 2047
 * encoded words (which are pure ASCII, so unaffected) expanded.
 */
function decodeHeaderText(value: string): string {
  return decodeEncodedWords(decodeText(Buffer.from(value, "latin1")));
}

/** RFC 2047 encoded words — how an accented Subject/From is supposed to travel. */
function decodeEncodedWords(value: string): string {
  return (
    value
      // Folding whitespace BETWEEN two encoded words is not data: without this, a name split
      // across two words gains a space in the middle.
      .replace(/\?=[ \t]+=\?/g, "?==?")
      .replace(
        /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
        (_full, charset: string, encoding: string, payload: string) => {
          const bytes =
            encoding.toLowerCase() === "b"
              ? Buffer.from(payload, "base64")
              : decodeQuotedPrintable(payload.replace(/_/g, " "));
          return decodeCharset(bytes, charset);
        }
      )
  );
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : full;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

/** Last-resort body text: an HTML-only mail, flattened so the words remain searchable. */
function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Walks the MIME tree, keeping text and recording attachments by NAME ONLY.
 *
 * Skipping payloads is the whole point: a scanned exhibit attached to a mail is uploaded as its
 * own document (and OCR'd properly), whereas its base64 inside the mail body would be tens of
 * thousands of meaningless characters chunked and embedded at real cost.
 */
function collectMimeParts(
  headers: Map<string, string>,
  body: string,
  depth: number,
  out: EmailContent
): void {
  const contentType = headers.get("content-type") ?? "text/plain";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const disposition = headers.get("content-disposition") ?? "";
  // Case is preserved for the filename (it is shown to the user) and folded only for the
  // inline/attachment test.
  const dispositionType = disposition.trim().toLowerCase();
  const filename = decodeHeaderText(
    paramOf(disposition, "filename") ?? paramOf(contentType, "name") ?? ""
  );

  if (mime.startsWith("multipart/") && depth < MAX_MIME_DEPTH) {
    const boundary = paramOf(contentType, "boundary");
    if (boundary) {
      const parts = splitOnBoundary(body, boundary).map((part) =>
        splitMimeMessage(part)
      );
      // multipart/alternative holds the SAME message twice (plain + HTML). Collecting the
      // branch separately is what lets us keep only the plain twin instead of indexing the
      // words once as prose and once as markup.
      if (mime === "multipart/alternative") {
        const branch: EmailContent = { texts: [], attachments: [] };
        for (const part of parts) {
          collectMimeParts(part.headers, part.body, depth + 1, branch);
        }
        const plain = branch.texts.filter((t) => t.mime !== "text/html");
        out.texts.push(...(plain.length > 0 ? plain : branch.texts));
        out.attachments.push(...branch.attachments);
        return;
      }
      for (const part of parts) {
        collectMimeParts(part.headers, part.body, depth + 1, out);
      }
      return;
    }
    // No boundary parameter: fall through and treat the body as text — a broken multipart
    // header should not cost us the message.
  }

  // A forwarded mail arrives as an attached message. Recurse so its subject and body are
  // indexed as text instead of as a wall of raw headers and boundaries.
  if (mime === "message/rfc822" && depth < MAX_MIME_DEPTH) {
    const nested = splitMimeMessage(
      decodeTransferEncoding(body, headers).toString("latin1")
    );
    // The forwarded message's own headers are part of the evidence (who wrote to whom, when),
    // so they are kept as text rather than dropped with the envelope.
    const summary = headerBlock(nested.headers);
    if (summary.length > 0) {
      out.texts.push({
        mime: "text/plain",
        text: `--- forwarded message ---\n${summary}`
      });
    }
    collectMimeParts(nested.headers, nested.body, depth + 1, out);
    return;
  }

  if (!mime.startsWith("text/") || dispositionType.startsWith("attachment")) {
    if (filename) out.attachments.push(filename);
    return;
  }

  const decoded = decodeCharset(
    decodeTransferEncoding(body, headers),
    paramOf(contentType, "charset")
  );
  const text = mime === "text/html" ? htmlToText(decoded) : decoded.trim();
  if (text.length === 0) return;
  out.texts.push({ mime, text });
}

/** The Subject/From/To/Cc/Date lines of a message, decoded, in a fixed order. */
function headerBlock(headers: Map<string, string>): string {
  return HEADER_LABELS.filter(([, key]) => headers.get(key))
    .map(
      ([label, key]) => `${label}: ${decodeHeaderText(headers.get(key) ?? "")}`
    )
    .join("\n");
}

/**
 * Turns an email into the document text a lawyer would expect: the headers that make it
 * evidence (who wrote to whom, when, about what) followed by the body.
 *
 * text/plain wins over text/html when both are present — same words, no markup.
 */
export function parseEmail(buffer: Buffer): string {
  // latin1 keeps one char per byte, so each part's own charset can still be applied after the
  // structure is known. Decoding the whole message as utf8 up front would corrupt base64 and
  // quoted-printable parts before they are ever split apart.
  const { headers, body } = splitMimeMessage(buffer.toString("latin1"));
  const out: EmailContent = { texts: [], attachments: [] };
  collectMimeParts(headers, body, 0, out);

  const sections = [headerBlock(headers)];
  if (out.attachments.length > 0) {
    sections.push(`Attachments: ${out.attachments.join(", ")}`);
  }
  sections.push(
    out.texts
      .map((t) => t.text)
      .join("\n\n")
      .trim()
  );
  return (
    sections
      .filter((section) => section.length > 0)
      .join("\n\n")
      // MIME is CRLF on the wire, but the chunker snaps its windows on "\n\n" paragraph
      // boundaries — which CRLF text never contains.
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  );
}

// ── Routing ───────────────────────────────────────────────────────────────────────────────

export type ParseRoute =
  | {
      kind:
        | "audio"
        | "image"
        | "pdf"
        | "docx"
        | "xlsx"
        | "email"
        | "html"
        | "text";
    }
  | { kind: "unsupported"; reason: string };

/** A zip's local headers store entry names uncompressed, so the container's flavour can be
 * identified without unzipping it. */
function zipContains(buffer: Buffer, entry: string): boolean {
  return buffer.indexOf(entry) >= 0;
}

function describeBytes(sniffed: SniffedType | null, buffer: Buffer): string {
  if (sniffed) return `a ${sniffed.toUpperCase()} file`;
  return looksBinary(buffer)
    ? "an unrecognised binary format"
    : "plain text, not an Office document";
}

/**
 * Decides which parser owns the file, from the bytes first and the name second.
 *
 * Kept pure and exported so the routing decisions — the ones that were silently wrong for the
 * mislabelled files in the first real bundle — are unit-testable without mammoth, unpdf or S3.
 */
export function resolveParseRoute(
  buffer: Buffer,
  contentType: string,
  filename: string
): ParseRoute {
  const lower = filename.toLowerCase();
  const type = (contentType || "").toLowerCase();

  if (buffer.length === 0) {
    return {
      kind: "unsupported",
      reason: `"${filename}" is empty (0 bytes) — nothing to extract.`
    };
  }

  // Audio can only be judged by name/type here; the codec zoo is not worth sniffing when the
  // transcription API accepts or rejects the file authoritatively.
  if (isAudio(type, lower)) return { kind: "audio" };

  const sniffed = sniffMagicBytes(buffer);

  // Bytes beat the extension: this is what turns the bundle's ".docx that is really a PDF"
  // and its renamed screenshots from hard failures into correctly parsed documents.
  if (sniffed && IMAGE_SNIFFS.has(sniffed)) return { kind: "image" };
  if (sniffed === "pdf") return { kind: "pdf" };

  if (sniffed === "zip") {
    if (zipContains(buffer, "word/document.xml")) return { kind: "docx" };
    if (
      zipContains(buffer, "xl/workbook.xml") ||
      zipContains(buffer, "xl/worksheets/")
    )
      return { kind: "xlsx" };
    if (zipContains(buffer, "ppt/presentation.xml")) {
      return {
        kind: "unsupported",
        reason: `"${filename}" is a PowerPoint presentation, which cannot be read — export it as PDF and upload that.`
      };
    }
    if (zipContains(buffer, "META-INF/manifest.xml")) {
      return {
        kind: "unsupported",
        reason: `"${filename}" is an OpenDocument file, which cannot be read — save it as .docx or PDF and upload that.`
      };
    }
    return {
      kind: "unsupported",
      reason: `"${filename}" is a ZIP archive, not a document — unzip it and upload the files inside.`
    };
  }

  if (sniffed === "ole2") {
    // SheetJS reads the legacy BIFF workbook, so only .doc/.msg are genuinely unreadable.
    if (XLSX_RE.test(lower) || type.includes("excel")) return { kind: "xlsx" };
    if (OUTLOOK_MSG_RE.test(lower)) {
      return {
        kind: "unsupported",
        reason: `"${filename}" is an Outlook .msg file, which cannot be read — export the message as .eml (or print it to PDF) and upload that.`
      };
    }
    return {
      kind: "unsupported",
      reason: `"${filename}" is a legacy Microsoft Office file (pre-2007 .doc/.xls), which cannot be read — open it and save as .docx, .xlsx or PDF.`
    };
  }

  // Email: no magic bytes exist, so the name/type is all we have. Checked after sniffing so a
  // ".eml" that is really a PDF export still routes to the PDF parser.
  if (EMAIL_RE.test(lower) || type.startsWith("message/rfc822")) {
    // An email is text on the wire, so binary bytes here mean it is not one (a renamed .msg
    // whose OLE2 header was stripped, a truncated download). Better refused than half-read.
    if (looksBinary(buffer)) {
      return {
        kind: "unsupported",
        reason: `"${filename}" is named like an email but its bytes are ${describeBytes(sniffed, buffer)} — export the message again as .eml.`
      };
    }
    return { kind: "email" };
  }

  // Declared-type routing, for files whose container has no signature of its own.
  if (type === "application/pdf" || lower.endsWith(".pdf"))
    return { kind: "pdf" };
  if (type.startsWith("image/") || IMAGE_RE.test(lower))
    return { kind: "image" };

  if (
    DOCX_RE.test(lower) ||
    type.includes("officedocument.wordprocessing") ||
    (type.includes("word") && !LEGACY_DOC_RE.test(lower))
  ) {
    // Self-extracting or gateway-padded archives push the zip header off offset 0, so give the
    // entry names one last look before condemning the file.
    if (zipContains(buffer, "word/document.xml")) return { kind: "docx" };
    // Otherwise: every .docx is a zip, and this file is not one. Failing here with the reason
    // beats handing mammoth a non-zip and surfacing "Can't find end of central directory".
    return {
      kind: "unsupported",
      reason: `"${filename}" is named like a Word document but its bytes are ${describeBytes(sniffed, buffer)} — it was renamed somewhere. Re-save it as .docx or PDF and upload that.`
    };
  }

  if (LEGACY_DOC_RE.test(lower)) {
    return {
      kind: "unsupported",
      reason: `"${filename}" is a legacy Word .doc file, which cannot be read — open it and save as .docx or PDF.`
    };
  }

  // A ".xls" is very often a CSV or an HTML table in disguise; SheetJS reads all three, so the
  // spreadsheet parser is still the right owner as long as the bytes are text.
  if (
    XLSX_RE.test(lower) ||
    type.includes("spreadsheet") ||
    type.includes("excel")
  ) {
    if (!looksBinary(buffer)) return { kind: "xlsx" };
    return {
      kind: "unsupported",
      reason: `"${filename}" is named like a spreadsheet but its bytes are ${describeBytes(sniffed, buffer)} — re-export it as .xlsx or CSV.`
    };
  }

  if (HTML_RE.test(lower) || type.startsWith("text/html"))
    return { kind: "html" };
  if (TEXT_RE.test(lower) || type.startsWith("text/")) {
    if (!looksBinary(buffer)) return { kind: "text" };
    return {
      kind: "unsupported",
      reason: `"${filename}" claims to be text but its bytes are ${describeBytes(sniffed, buffer)} — it cannot be indexed as-is.`
    };
  }

  // The old catch-all lived here and returned buffer.toString("utf8") for ANYTHING.
  if (looksBinary(buffer)) {
    return {
      kind: "unsupported",
      reason: `"${filename}" is not a readable document: its bytes are ${describeBytes(sniffed, buffer)}${type ? ` (declared ${contentType})` : ""}. Convert it to PDF and upload that.`
    };
  }
  return { kind: "text" };
}

// ── Parsing ───────────────────────────────────────────────────────────────────────────────

/**
 * Single exit point for extracted text: every page is sanitised HERE, before it can reach
 * buildFullText, so the chunker's offsets are computed over exactly the string that gets stored
 * (see sanitizeForStorage for why doing this after chunking would break citations).
 */
function parsed(
  pages: string[],
  options: {
    pageCount?: number;
    needsOcr?: boolean;
    pageKind?: "page" | "sheet" | "blob";
    sheetNames?: string[];
  } = {}
): ParsedDocument {
  const clean = pages.map(sanitizeForStorage);
  const dropped = pages.reduce(
    (total, page, i) => total + (page.length - clean[i].length),
    0
  );
  return {
    pages: clean,
    pageCount: options.pageCount ?? Math.max(1, clean.length),
    needsOcr: options.needsOcr ?? clean.join("").trim().length === 0,
    needsTranscription: false,
    droppedChars: dropped,
    // Default by shape: several elements are genuine pages, a single element is one text blob.
    pageKind: options.pageKind ?? (clean.length > 1 ? "page" : "blob"),
    sheetNames: options.sheetNames
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function parsePdf(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    return parsed(pages, {
      pageCount: totalPages ?? pages.length,
      // Stated, not inferred: pdf.js told us these are pages, and `parsed`'s shape heuristic would
      // call a ONE-page PDF a blob. That is not cosmetic — a blob gets divided into §-sections, so
      // a 1-page filing would be indexed as §1/§2 and pinning "page 1" (which is what the viewer
      // offers, since pdf.js reports numPages = 1) would return only the first section, silently
      // handing the model half the page as though it were all of it.
      pageKind: "page",
      // An empty text layer means a scan, not a failure → OCR owns it from here.
      needsOcr: pages.join("").trim().length === 0
    });
  } catch (err) {
    throw new Error(
      `Could not read "${filename}" as a PDF (${message(err)}). The file may be corrupted or password-protected — try re-exporting or re-downloading it.`
    );
  }
}

async function parseDocx(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return parsed([value], { pageCount: 1 });
  } catch (err) {
    // Reached only for a zip that DOES contain word/document.xml, i.e. a genuinely damaged
    // .docx. mammoth's own wording ("Can't find end of central directory", "Could not find the
    // body element") tells a lawyer nothing actionable, so it is demoted to a detail.
    throw new Error(
      `Could not read "${filename}" as a Word document (${message(err)}). Open it in Word and re-save it as .docx or PDF.`
    );
  }
}

function parseXlsx(buffer: Buffer, filename: string): ParsedDocument {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    // One "page" per sheet, CSV-serialised, so a citation can name the sheet it came from.
    const pages = wb.SheetNames.map(
      (name) => `# ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`
    );
    return parsed(pages, {
      pageCount: Math.max(1, pages.length),
      pageKind: "sheet",
      sheetNames: wb.SheetNames
    });
  } catch (err) {
    throw new Error(
      `Could not read "${filename}" as a spreadsheet (${message(err)}). Re-export it as .xlsx or CSV.`
    );
  }
}

/**
 * Extracts the text layer of a document. Images / scanned PDFs return needsOcr=true; audio
 * returns needsTranscription=true. The worker owns those two follow-up calls.
 *
 * Anything that cannot yield text throws with a message written for the lawyer who uploaded it —
 * the worker stores that on the document as parse_status 'failed'.
 */
export async function parseDocument(
  buffer: Buffer,
  contentType: string,
  filename: string
): Promise<ParsedDocument> {
  const route = resolveParseRoute(buffer, contentType, filename);
  switch (route.kind) {
    case "unsupported":
      throw new Error(route.reason);
    case "audio":
      return {
        pages: [],
        pageCount: 1,
        needsOcr: false,
        needsTranscription: true,
        droppedChars: 0,
        // No text yet — the worker decides the real kind once Whisper returns ('blob': speech has
        // no pages).
        pageKind: "blob"
      };
    case "image":
      return {
        pages: [],
        pageCount: 1,
        needsOcr: true,
        needsTranscription: false,
        droppedChars: 0,
        // No text yet — OCR will return one entry per scanned page, so the worker sets 'page'.
        pageKind: "page"
      };
    case "pdf":
      return parsePdf(buffer, filename);
    case "docx":
      return parseDocx(buffer, filename);
    case "xlsx":
      return parseXlsx(buffer, filename);
    case "email":
      return parsed([parseEmail(buffer)], { pageCount: 1, needsOcr: false });
    case "html":
      // needsOcr stays false even when the flattening yields nothing: there is no image to OCR
      // in an HTML file, so an empty result is a failure for the worker to report, not a scan.
      return parsed([htmlToText(decodeText(buffer))], {
        pageCount: 1,
        needsOcr: false
      });
    case "text":
      return parsed([decodeText(buffer)], { pageCount: 1, needsOcr: false });
  }
}
