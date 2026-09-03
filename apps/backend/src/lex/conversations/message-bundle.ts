import { sanitizeForStorage } from "../documents/chunker";

/**
 * Builds the "hand this answer to someone else" bundle: every pièce an answer cited, plus a
 * reference table saying which marker points at which pièce and page.
 *
 * Pure and service-free, so the layout of the zip — which document gets which entry name, which
 * marker resolves to which page, what a missing source reads as — is testable without S3 or a
 * database. MessageBundleService does the fetching; everything here decides what the reader sees.
 */

// ── Shape of one citation row, as the service reads it back ────────────────────────────────
export interface BundleCitationRow {
  /** 1-based marker the answer wrote inline, e.g. [401]. Never null: the query filters those out. */
  marker: number;
  documentId: string | null;
  filename: string | null;
  /** Set when the anchor is a page rather than a chunk: 'p. 7' | 'sheet: Facturen' | '§3'. */
  pageLabel: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  s3Key: string | null;
  s3VersionId: string | null;
  sizeBytes: number | null;
}

export interface BundleDocument {
  documentId: string;
  filename: string;
  /** Path inside the zip, e.g. "pieces/01_CONCLUSIONS_24_08_2024.pdf". */
  entryName: string;
  s3Key: string;
  s3VersionId: string | null;
  sizeBytes: number | null;
  /** Every marker in the answer pointing at this document, ascending. */
  citations: BundleCitationRow[];
}

export interface BundlePlan {
  documents: BundleDocument[];
  /**
   * Citations with no file to put in the zip. `lex_citations.document_id` is ON DELETE SET NULL, so
   * a marker outlives the pièce it cites. They stay in the table as "non joint": dropping them
   * would make the bundle claim the answer cited fewer sources than it did.
   */
  orphans: BundleCitationRow[];
  totalBytes: number;
}

// ── Entry naming ───────────────────────────────────────────────────────────────────────────

/**
 * Filenames come from whatever the uploader's filesystem allowed and go into a zip a stranger
 * unpacks on an unknown OS. Path separators and leading dots are the security-relevant part — an
 * entry named "../../x" is a zip-slip — the rest is legibility.
 */
export function sanitizeFilename(filename: string): string {
  const flat = sanitizeForStorage(filename)
    .normalize("NFC")
    .replace(/[\\/]+/g, "_")
    // Reserved on Windows. \t \n \r \f survive sanitizeForStorage by design, and none of them
    // belong in a filename.
    .replace(/[<>:"|?*\t\n\r\f]+/g, "_")
    .replace(/ +/g, " ")
    // "." and ".." are traversal segments; a leading dot also hides the file on unix.
    .replace(/\.{2,}/g, "_")
    .replace(/_{2,}/g, "_")
    .trim()
    .replace(/^\.+/, "");
  if (!flat) return "document";

  const dot = flat.lastIndexOf(".");
  const hasExt = dot > 0 && flat.length - dot <= 12;
  const stem = hasExt ? flat.slice(0, dot) : flat;
  const ext = hasExt ? flat.slice(dot) : "";
  return `${stem.slice(0, 80).trim() || "document"}${ext}`;
}

/**
 * "pieces/07_Inventaire.pdf" — numbered by citation order, so the folder listing reads in the order
 * the answer cites. `taken` is mutated: the same filename really does appear twice in a court
 * bundle, and two zip entries under one name is a file the reader silently loses.
 */
export function entryNameFor(
  filename: string,
  order: number,
  taken: Set<string>
): string {
  const safe = sanitizeFilename(filename);
  const n = String(order).padStart(2, "0");
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";

  let candidate = `pieces/${n}_${safe}`;
  let dedupe = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `pieces/${n}_${stem} (${dedupe})${ext}`;
    dedupe += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ── Planning ───────────────────────────────────────────────────────────────────────────────

/**
 * Groups citation rows into one entry per document, ordered by the first marker that cites it.
 *
 * Deduplicated by document id, not by filename: a real workspace holds the same annex under three
 * names, and a bundle built per marker would ship the same PDF eight times.
 */
export function planBundle(rows: readonly BundleCitationRow[]): BundlePlan {
  const byDocument = new Map<string, BundleDocument>();
  const orphans: BundleCitationRow[] = [];
  const taken = new Set<string>();

  for (const row of [...rows].sort((a, b) => a.marker - b.marker)) {
    if (!row.documentId || !row.s3Key) {
      orphans.push(row);
      continue;
    }
    const existing = byDocument.get(row.documentId);
    if (existing) {
      existing.citations.push(row);
      continue;
    }
    const filename = row.filename ?? "document";
    byDocument.set(row.documentId, {
      documentId: row.documentId,
      filename,
      entryName: entryNameFor(filename, byDocument.size + 1, taken),
      s3Key: row.s3Key,
      s3VersionId: row.s3VersionId,
      sizeBytes: row.sizeBytes,
      citations: [row]
    });
  }

  const documents = [...byDocument.values()];
  return {
    documents,
    orphans,
    totalBytes: documents.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0)
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────

/** "p. 12", "p. 12-14", "sheet: Facturen", or a dash when the source has no pagination. */
export function pageLabelFor(row: BundleCitationRow): string {
  if (row.pageFrom && row.pageTo && row.pageTo !== row.pageFrom)
    return `p. ${row.pageFrom}-${row.pageTo}`;
  if (row.pageFrom) return `p. ${row.pageFrom}`;
  return row.pageLabel ?? "—";
}

/** A pipe inside a cell ends the column early, and filenames do contain them. */
function cell(text: string): string {
  return sanitizeForStorage(text)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

export interface BundleMeta {
  messageId: string;
  conversationTitle: string | null;
  /** ISO timestamp of the answer. Rendered as-is; the reader's locale is not ours to guess. */
  createdAt: string;
  content: string;
}

/**
 * REFERENCES.md: one row per marker — which pièce it points at, which page, and which file in the
 * zip to open.
 *
 * A table, in marker order, because that is the order someone reads `reponse.md` in: hit a [401],
 * find the row, open the file. It carries no passages. The earlier version quoted the cited span
 * under every marker, which turned a seven-pièce answer into pages of blockquotes that nobody reads
 * — and the passage is already in the pièce, one page reference away.
 *
 * French, because the bundle is read by a Belgian confrère rather than by the app.
 */
export function renderReferences(
  plan: BundlePlan,
  meta: BundleMeta,
  /** Documents whose S3 object could not be fetched, id → reason. See MessageBundleService.write. */
  failed: ReadonlyMap<string, string> = new Map()
): string {
  // Every marker, from both sources, back in the order the answer wrote them.
  const rows = [
    ...plan.documents.flatMap((doc) =>
      doc.citations.map((c) => ({
        marker: c.marker,
        piece: doc.filename,
        page: pageLabelFor(c),
        file: failed.has(doc.documentId)
          ? `non joint (${failed.get(doc.documentId)})`
          : `\`${doc.entryName}\``
      }))
    ),
    ...plan.orphans.map((c) => ({
      marker: c.marker,
      piece: c.filename ?? "pièce supprimée",
      page: pageLabelFor(c),
      file: "non joint (pièce retirée du dossier)"
    }))
  ].sort((a, b) => a.marker - b.marker);

  return [
    "# Références",
    "",
    `**Dossier :** ${cell(meta.conversationTitle ?? "Conversation")}`,
    `**Réponse du :** ${meta.createdAt}`,
    `**Références :** ${rows.length} · **Pièces :** ${plan.documents.length}`,
    "",
    "Chaque numéro est le marqueur du même numéro dans `reponse.md`.",
    "",
    "| # | Pièce | Page | Fichier |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| [${r.marker}] | ${cell(r.piece)} | ${cell(r.page)} | ${cell(r.file)} |`
    ),
    ""
  ].join("\n");
}

/**
 * reponse.md: the answer verbatim. Markers are left untouched — they are the index into
 * REFERENCES.md and into the numbered files.
 */
export function renderAnswer(meta: BundleMeta): string {
  return [
    `# ${meta.conversationTitle ?? "Conversation"}`,
    "",
    `**Réponse du :** ${meta.createdAt}`,
    "",
    "Les marqueurs `[n]` renvoient à `REFERENCES.md` et aux fichiers du dossier `pieces/`.",
    "",
    "---",
    "",
    sanitizeForStorage(meta.content).trim(),
    ""
  ].join("\n");
}

/**
 * The download name. ASCII-only: `Content-Disposition` is latin-1 on the wire, and a `filename*`
 * fallback is more machinery than a download name is worth.
 */
export function bundleFilename(meta: BundleMeta): string {
  const slug = (meta.conversationTitle ?? "dossier")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();
  return `pieces-citees-${slug || "dossier"}-${meta.messageId.slice(0, 8)}.zip`;
}
