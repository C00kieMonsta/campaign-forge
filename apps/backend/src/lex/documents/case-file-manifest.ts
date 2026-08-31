import type { LexLifecycleState, LexParseStatus } from "@packages/types";
import { estimateTokens } from "../../shared/tokens";
import { sanitizeForStorage } from "./chunker";
import { isAudio } from "./document-parser";

/**
 * Renders the CASE FILE block: the list of every document in a workspace, injected into every
 * prompt so the model always knows what exists.
 *
 * The bug this fixes: the assembler already told the model "never reply that you cannot access a
 * file" (context-assembler.service.ts), but gave it nothing to enumerate. A document whose text
 * was not retrieved for the current turn was indistinguishable from a document that had never been
 * uploaded, so the model denied having files the user could see on screen.
 *
 * Pure and exported, with no injected services, so the budget arithmetic is testable without a
 * database. Same reasoning as selectTurns in the context assembler: this decides what a lawyer's
 * question is answered from, and "it looked right" is not a standard it should be held to.
 */

// ── Budget ────────────────────────────────────────────────────────────────────────────────
/**
 * Token ceiling for the whole block, framing included.
 *
 * Larger than the per-authority DIGEST_MAX_TOKENS (1500) because a workspace has one case file and
 * several authorities, and because the case file is what every question is actually about. It
 * displaces nothing: SOURCES, the rolling summary and the verbatim turns keep their budgets.
 *
 * A CEILING, NOT A COST. The renderer keeps the FIRST tier that fits, so a small workspace spends
 * a few hundred tokens and only a very large one approaches this number. Measured on the real
 * shapes: 20 documents render in full at ~1650 tokens, 68 with summaries at ~3350, 140 as one line
 * each at ~3700.
 *
 * 6000 rather than 4000 because 4000 pushed a 250-document workspace to the counts tier, where no
 * document is named individually — which is the bug this block exists to fix, arriving at a case
 * size a succession file reaches over a few years. 6000 x 3.4 = 20400 chars, which carries roughly
 * 340 documents at the filenames tier. Raising it costs nothing for the small workspaces that never
 * reach it.
 *
 * Measured with the shared estimateTokens on the FINAL string, exactly as capDigest does, so the
 * ceiling holds for the text actually sent rather than for a sum of per-entry worst cases.
 */
const MANIFEST_MAX_TOKENS = 6000;

const MANIFEST_FULL_SUMMARY_CHARS = 400;
const MANIFEST_BRIEF_SUMMARY_CHARS = 160;
const MANIFEST_META_CHARS = 120;
const MANIFEST_KEY_NAMES = 6;
const MANIFEST_TAGS = 6;
/** Filenames named in the archived group before it degrades to a bare count. */
const MANIFEST_ARCHIVED_NAMES = 12;

/**
 * How much of a shared filename's folder path is appended to disambiguate it.
 *
 * A folder drop routinely contains two `scan.pdf` in different subfolders, and the framing tells
 * the model to refer to documents by filename. Without this the instruction is ambiguous on
 * exactly the input the block is sized for.
 */
const MANIFEST_PATH_CHARS = 48;

/**
 * Detail tiers, richest first. The renderer walks them in order and keeps the first that fits.
 *
 * `counts` is not in this list because it is the fallback rather than a candidate: reaching it
 * means no document is listed individually, which is the failure mode this whole block exists to
 * prevent.
 */
export type ManifestTier =
  | "full"
  | "brief"
  | "index"
  | "names"
  | "filenames"
  | "counts";

const TIERS: readonly ManifestTier[] = [
  "full",
  "brief",
  "index",
  "names",
  "filenames"
];

// ── Input ─────────────────────────────────────────────────────────────────────────────────

/** One document as the manifest needs it. Every field is already a column; see DOC_COLUMNS. */
export interface ManifestDoc {
  id: string;
  filename: string;
  contentType: string | null;
  parseStatus: LexParseStatus;
  lifecycleState: LexLifecycleState;
  /** YYYY-MM-DD. Already narrowed by dateOnly, never through toISOString(). */
  timelineDate: string | null;
  pageCount: number | null;
  durationSeconds: number | null;
  summary: string | null;
  language: string | null;
  keyNames: string[];
  tags: string[];
  /** Relative path from a folder upload, used only to disambiguate a repeated filename. */
  sourcePath: string | null;
  /** Filename of the pièce this one duplicates, resolved by the query's self-join. */
  duplicateOfFilename: string | null;
}

export interface BuiltManifest {
  text: string;
  tier: ManifestTier;
  /** Documents rendered on a line of their own. 0 at the counts tier. */
  listed: number;
  /** Every non-archived document in the workspace. */
  total: number;
  archived: number;
}

// ── Text helpers ──────────────────────────────────────────────────────────────────────────

/** Collapses runs of whitespace. Same shape as the authority worker's local helper. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Filenames and summaries go straight into a prompt, so they get the same treatment as text on its
 * way to the database. Three documents of the original 65-file bundle carried NUL bytes.
 */
function clean(text: string): string {
  return collapse(sanitizeForStorage(text));
}

function clip(text: string, max: number): string {
  const t = clean(text);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** mm:ss for a voice note's length. */
function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── State words ───────────────────────────────────────────────────────────────────────────

/**
 * One word per document saying what can be done with it, quotable back to the user.
 *
 * parse_status='duplicate' and lifecycle_state='superseded' are written in the SAME UPDATE by the
 * ingestion worker, so the first branch reads one signal twice rather than two independent ones.
 *
 * The default is PROCESSING, not a throw and not a blank: a parse_status value added later must
 * degrade to "in the file, text not ready", never to a document that looks absent. That is the
 * whole point of the block.
 */
export function stateOf(doc: ManifestDoc): string {
  if (doc.parseStatus === "duplicate" || doc.lifecycleState === "superseded") {
    return doc.duplicateOfFilename
      ? `DUPLICATE of ${clean(doc.duplicateOfFilename)}`
      : "DUPLICATE";
  }
  if (doc.parseStatus === "ready") return "INDEXED";
  if (doc.parseStatus === "awaiting_upload") return "UPLOADING";
  if (doc.parseStatus === "needs_ocr") return "NEEDS_OCR";
  if (doc.parseStatus === "failed") return "FAILED";
  return "PROCESSING";
}

// ── Entry lines ───────────────────────────────────────────────────────────────────────────

/**
 * The filename as the model should refer to it, with a path tail only when another document in the
 * workspace carries the same name.
 *
 * Never shortened. An earlier design truncated long filenames from the middle to hold a line
 * width, which quietly restored the bug: the framing tells the model that a filename appearing
 * nowhere in this list is not in the case file, and a truncated filename does not appear. A line
 * that runs long costs a few tokens; a filename the model cannot match costs the user the answer.
 */
function nameOf(doc: ManifestDoc, shared: ReadonlySet<string>): string {
  const name = clean(doc.filename);
  if (!shared.has(name.toLowerCase()) || !doc.sourcePath) return name;
  const path = clean(doc.sourcePath);
  const tail =
    path.length <= MANIFEST_PATH_CHARS
      ? path
      : `…${path.slice(-MANIFEST_PATH_CHARS)}`;
  return `${name} (in ${tail})`;
}

/** Filenames held by more than one document, lowercased. */
function sharedNames(docs: readonly ManifestDoc[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const d of docs) {
    const key = clean(d.filename).toLowerCase();
    if (seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}

/**
 * The header line. Fields are dropped from the LEAST load-bearing end as the tier narrows, so the
 * filename and the state word survive every tier: those two are what the user names and what the
 * model has to say about it.
 */
function headerLine(
  doc: ManifestDoc,
  ordinal: number,
  tier: ManifestTier,
  shared: ReadonlySet<string>
): string {
  const audio = isAudio(doc.contentType ?? "", doc.filename);
  const wide = tier === "full" || tier === "brief" || tier === "index";
  const size =
    audio && doc.durationSeconds
      ? `voice note ${duration(doc.durationSeconds)}`
      : doc.pageCount
        ? `${doc.pageCount} p.`
        : null;

  const fields = [
    `#${ordinal}`,
    doc.timelineDate ?? "undated",
    nameOf(doc, shared),
    ...(wide && size ? [size] : []),
    ...(wide && doc.language ? [doc.language] : []),
    stateOf(doc)
  ];
  return fields.join(" | ");
}

/** names + tags, full tier only. Omitted when the summariser found neither. */
function metaLine(doc: ManifestDoc): string | null {
  const parts: string[] = [];
  if (doc.keyNames.length > 0) {
    parts.push(
      `names: ${doc.keyNames.slice(0, MANIFEST_KEY_NAMES).join(", ")}`
    );
  }
  if (doc.tags.length > 0) {
    parts.push(`tags: ${doc.tags.slice(0, MANIFEST_TAGS).join(", ")}`);
  }
  if (parts.length === 0) return null;
  return `   ${clip(parts.join(" | "), MANIFEST_META_CHARS)}`;
}

/**
 * A duplicate never carries a summary or a meta line, at any tier: its summary is its original's,
 * and repeating it invites the model to work from the superseded copy. Its state word already
 * names the original.
 */
function isDuplicate(doc: ManifestDoc): boolean {
  return doc.parseStatus === "duplicate" || doc.lifecycleState === "superseded";
}

function entryLines(
  doc: ManifestDoc,
  ordinal: number,
  tier: ManifestTier,
  shared: ReadonlySet<string>
): string[] {
  const lines = [headerLine(doc, ordinal, tier, shared)];
  if (isDuplicate(doc)) return lines;

  if (tier === "full") {
    const meta = metaLine(doc);
    if (meta) lines.push(meta);
  }
  const cap =
    tier === "full"
      ? MANIFEST_FULL_SUMMARY_CHARS
      : tier === "brief"
        ? MANIFEST_BRIEF_SUMMARY_CHARS
        : 0;
  if (cap > 0 && doc.summary) {
    const summary = clip(doc.summary, cap);
    if (summary) lines.push(`   ${summary}`);
  }
  return lines;
}

// ── Counts ────────────────────────────────────────────────────────────────────────────────

/**
 * The totals line, emitted FIRST.
 *
 * Same reason the authority digest puts its coverage line first: it is the one line that must
 * survive whatever else is dropped. At the counts tier it IS the block; at every other tier it
 * gives the model a checkable total, so a mismatch between the count and the lines is visible.
 */
function countsLines(
  docs: readonly ManifestDoc[],
  archivedDocs: readonly ManifestDoc[]
): string[] {
  const by = (predicate: (d: ManifestDoc) => boolean) =>
    docs.filter(predicate).length;
  const groups: Array<[number, string]> = [
    [by((d) => stateOf(d) === "INDEXED"), "indexed"],
    [by((d) => stateOf(d) === "PROCESSING"), "still processing"],
    [by((d) => stateOf(d) === "UPLOADING"), "still uploading"],
    [by((d) => stateOf(d) === "NEEDS_OCR"), "awaiting OCR"],
    [by((d) => stateOf(d) === "FAILED"), "unreadable"],
    [by((d) => stateOf(d).startsWith("DUPLICATE")), "duplicate"]
  ];
  const breakdown = groups
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");

  const lines = [
    `TOTAL: ${docs.length} document(s) in this workspace` +
      (breakdown ? ` — ${breakdown}` : "") +
      (archivedDocs.length > 0 ? `; ${archivedDocs.length} archived` : "") +
      "."
  ];

  const dated = docs
    .map((d) => d.timelineDate)
    .filter((d): d is string => d !== null)
    .sort();
  if (dated.length > 0) {
    const undated = docs.length - dated.length;
    lines.push(
      `Timeline: ${dated[0]} → ${dated[dated.length - 1]}.` +
        (undated > 0 ? ` ${undated} document(s) carry no date.` : "")
    );
  }
  return lines;
}

/**
 * Archived documents as one bounded group rather than per-document lines.
 *
 * Listed at all because "why is the 2003 letter not in your answer" must be answerable with "you
 * archived it" rather than "I do not have it": the user can see it on the archives screen.
 * Bounded because an archive grows without limit and is the least useful part of the block.
 */
function archivedLine(archivedDocs: readonly ManifestDoc[]): string | null {
  if (archivedDocs.length === 0) return null;
  const shown = archivedDocs.slice(0, MANIFEST_ARCHIVED_NAMES);
  const rest = archivedDocs.length - shown.length;
  return (
    `ARCHIVED (set aside by the user; not retrieved for this turn and not citable): ` +
    `${archivedDocs.length} document(s) — ` +
    shown.map((d) => clean(d.filename)).join(", ") +
    (rest > 0 ? `, and ${rest} more` : "") +
    ". Ask the user to restore one if the answer needs it."
  );
}

// ── Framing ───────────────────────────────────────────────────────────────────────────────

const HEAD =
  "CASE FILE — the complete inventory of the documents in this workspace. This is a CATALOGUE, " +
  "not evidence. Its only job is to tell you what exists.";

const LISTED_RULES =
  "Every document the user has in this workspace is listed below, whatever its state. If a " +
  "filename appears here, the document EXISTS and the user has given it to you. Never reply that " +
  "a file is missing, was not provided, or that you cannot see it, when its filename is in this " +
  "list. A listed document whose text is not in the SOURCES block was simply not retrieved for " +
  "this turn: say that, name the document, and offer to look at it.\n\n" +
  "The state word on each line says what can be done with the document. INDEXED means its text " +
  "is searchable and citable, so it can appear in SOURCES. PROCESSING, UPLOADING, NEEDS_OCR and " +
  "FAILED mean its text has not been read yet: say that the document is in the file but is still " +
  "being processed, or could not be read, never that it is absent. DUPLICATE means another " +
  "document holds the same content; work from that one.";

const FILENAMES_RULE =
  "This workspace holds too many documents to describe each one, so the list below is filenames " +
  "only, separated by semicolons. A name with no state in brackets after it is INDEXED: its text " +
  "is searchable and citable. A name followed by a state in brackets is in that state.";

const COUNTS_RULES =
  "The individual documents are NOT listed: this workspace holds too many for one block. A " +
  "filename the user names is very likely in the file. Search for it and report what you find; " +
  "never say a document is missing on the strength of this block alone.";

const NO_CITE_RULES =
  "NEVER CITE FROM THIS BLOCK. The dates, names, tags and descriptions here are DERIVED metadata " +
  "written by an automatic summariser, not text from the documents. They can be wrong and they " +
  "are not quotable. Every [n] marker in your answer must point at a numbered SOURCE and at " +
  "nothing else. If a fact you want to state appears only here, attribute it to the document's " +
  "description or offer to open the document, and do not present it as sourced.\n\n" +
  "The #n numbers are handles for this block only. They are not citation markers, they change " +
  "when a document is added, and they must never be written as [n].";

// ── Render ────────────────────────────────────────────────────────────────────────────────

function render(
  docs: readonly ManifestDoc[],
  archivedDocs: readonly ManifestDoc[],
  tier: ManifestTier
): string {
  const shared = sharedNames([...docs, ...archivedDocs]);
  const sections = [HEAD, countsLines(docs, archivedDocs).join("\n")];

  if (tier === "counts") {
    sections.push(COUNTS_RULES);
  } else if (docs.length > 0) {
    sections.push(
      tier === "filenames"
        ? `${LISTED_RULES}\n\n${FILENAMES_RULE}`
        : LISTED_RULES
    );
    sections.push(
      tier === "filenames"
        ? // The densest tier: filenames only, comma-joined, and a state word ONLY where the state
          // is not the ordinary one. Most documents in a large workspace are indexed, so spelling
          // "INDEXED" out 300 times buys nothing and costs the tier ~40 documents of headroom.
          // The framing says what an unannotated name means.
          docs
            .map((d) => {
              const state = stateOf(d);
              return state === "INDEXED"
                ? clean(d.filename)
                : `${clean(d.filename)} (${state})`;
            })
            .join("; ")
        : docs.flatMap((d, i) => entryLines(d, i + 1, tier, shared)).join("\n")
    );
  }

  const archived = archivedLine(archivedDocs);
  if (archived) sections.push(archived);
  sections.push(NO_CITE_RULES);
  return sections.join("\n\n");
}

/**
 * Picks the richest tier whose rendered block fits MANIFEST_MAX_TOKENS.
 *
 * DELIBERATELY UNLIKE capDigest, which keeps the head and drops the tail. Dropping the tail is
 * right for an authority: a map that stops at art. 900 still tells the model the code continues,
 * and retrieval reaches those articles anyway. It is wrong here, because a document list that
 * stops at document 40 tells the model document 41 does not exist, which is the exact bug being
 * fixed. So the whole block is measured and the DETAIL is reduced instead.
 *
 * The invariant: at any tier other than `counts`, every document in scope appears in the block.
 * `counts` is reached only past roughly 280 documents, where nothing can be listed and the framing
 * says so.
 *
 * Returns null for an empty workspace rather than an empty block: `blocks` stays honest for the
 * usage log, and a block headed "the complete inventory" followed by nothing is a worse prompt
 * than no block at all.
 */
export function buildManifest(
  docs: readonly ManifestDoc[],
  archivedDocs: readonly ManifestDoc[] = []
): BuiltManifest | null {
  if (docs.length === 0 && archivedDocs.length === 0) return null;

  for (const tier of TIERS) {
    const text = render(docs, archivedDocs, tier);
    if (estimateTokens(text) <= MANIFEST_MAX_TOKENS) {
      return {
        text,
        tier,
        listed: docs.length,
        total: docs.length,
        archived: archivedDocs.length
      };
    }
  }
  return {
    text: render(docs, archivedDocs, "counts"),
    tier: "counts",
    listed: 0,
    total: docs.length,
    archived: archivedDocs.length
  };
}
