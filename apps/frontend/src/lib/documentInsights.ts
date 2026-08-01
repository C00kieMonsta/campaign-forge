// Pure derivations behind the Lex documents view: which tags are worth showing, the chronology as
// year groups, the CO-MENTION graph and its layout, and the selection arithmetic behind
// click / cmd-click / shift-click.
//
// Why a separate module rather than the component: this logic decides what the lawyer sees, so it
// has to be testable, and a module that reaches ./api cannot be loaded by the CJS jest runner
// (api.ts reads import.meta.env at module scope — the same reason uploadCandidates.ts exists).
//
// Everything here is DETERMINISTIC: identical input gives identical output in identical order.
// Every ordering is an explicit comparator, never an implicit map/sort-stability accident, and
// there is no randomness and no clock. This view is one she returns to across sessions; a graph
// that rotates or a tag row that reshuffles between renders reads as broken data, not as a
// cosmetic wobble.

import type { LexLifecycleState, LexParseStatus } from "@packages/types";

/**
 * The document fields these derivations read. `LexDocument` from @packages/types satisfies it, so
 * the view passes its documents straight through; each function asks only for the subset it needs
 * (via `Pick`) so nothing here can quietly start depending on more of the document.
 */
export interface InsightDocument {
  id: string;
  filename: string;
  timelineDate?: string | null;
  summary?: string | null;
  lifecycleState: LexLifecycleState;
  parseStatus: LexParseStatus;
  tags: readonly string[];
  keyNames: readonly string[];
}

/**
 * Code-unit comparison, deliberately not localeCompare: collation depends on the runtime's ICU
 * data, so localeCompare can order two names differently in two browsers. As a tie-break its only
 * job is to be the same everywhere, every time.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------------------------
// Tag distinctiveness
// ---------------------------------------------------------------------------------------------

/**
 * Counting key for a tag: whitespace-collapsed and case-folded, so a document tagged "Succession"
 * is not counted apart from the 27 tagged "succession" and thereby made to look rare. This folds
 * two SPELLINGS of one label — the same reasoning as personKey, which folds case and accents on a
 * name for exactly this reason and refuses to fold anything beyond letter-identity.
 */
function tagKey(tag: string): string {
  return collapseWhitespace(tag).toLowerCase();
}

/**
 * Tag key → how many DOCUMENTS carry it (not how many times it occurs; a tag repeated inside one
 * document is still one document).
 *
 * The view should compute this once per document list and feed it to rankTagsWithFrequencies per
 * row — see the ceiling note on rankTagsByDistinctiveness.
 */
export function countTagFrequencies(
  docs: readonly Pick<InsightDocument, "tags">[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const raw of doc.tags) {
      const key = tagKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The document's own tags, rarest-across-the-corpus first, capped at `limit`, rendered in the
 * document's own spelling.
 *
 * Rarity is the whole point: in this case file "succession" sits on 28 of 55 documents and
 * "Belgique" on 21, so showing tags in document order mostly repeats what the corpus already says.
 * A tag on 2 documents tells you what THIS document is.
 *
 * Ties break on the document's own tag order (ingestion emits them roughly by prominence). That is
 * an explicit index comparison rather than a reliance on Array.prototype.sort being stable — the
 * requirement is a row that never reshuffles, and it should not rest on an engine guarantee a
 * reader has to look up.
 */
export function rankTagsWithFrequencies(
  frequencies: ReadonlyMap<string, number>,
  tags: readonly string[],
  limit: number
): string[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const candidates: { tag: string; count: number; index: number }[] = [];
  tags.forEach((raw, index) => {
    const key = tagKey(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    // A tag the frequency map has never seen is on at least this document, so 1 — never 0, which
    // would rank an unknown tag above a genuinely unique one.
    candidates.push({
      tag: collapseWhitespace(raw),
      count: frequencies.get(key) ?? 1,
      index
    });
  });
  candidates.sort((a, b) => a.count - b.count || a.index - b.index);
  return candidates.slice(0, limit).map((c) => c.tag);
}

/**
 * Convenience wrapper: recounts the corpus on every call, which is O(documents x tags) per row.
 * At 55 documents that is free. The ceiling is a few thousand documents, where the view should
 * hoist countTagFrequencies out of the row loop (memoized on the document list) and call
 * rankTagsWithFrequencies directly.
 */
export function rankTagsByDistinctiveness(
  docs: readonly Pick<InsightDocument, "tags">[],
  doc: Pick<InsightDocument, "tags">,
  limit: number
): string[] {
  return rankTagsWithFrequencies(countTagFrequencies(docs), doc.tags, limit);
}

// ---------------------------------------------------------------------------------------------
// Chronology grouping
// ---------------------------------------------------------------------------------------------

/**
 * The four-digit year a document belongs to, or null when it has none. A timelineDate we cannot
 * read a year out of is UNDATED, not filed under year 0 — inventing a position on the timeline is
 * worse than admitting there is none.
 */
export function yearOf(
  doc: Pick<InsightDocument, "timelineDate">
): string | null {
  const match = /^(\d{4})/.exec(doc.timelineDate ?? "");
  return match ? match[1] : null;
}

/**
 * One rail of the chronology. A discriminated union so the undated group cannot be mistaken for a
 * year: TypeScript refuses `group.year` until the caller has narrowed on `kind`.
 */
export type YearGroup<T> =
  | { kind: "year"; year: string; documents: T[] }
  | { kind: "undated"; documents: T[] };

export interface YearGrouping<T> {
  /**
   * Every group in render order, undated LAST. Deliberately the only list on this shape: a caller
   * mapping over `groups` renders undated documents whether they thought about them or not, which
   * is the point — a document with no extracted date must stay reachable, and dropping it silently
   * is how a piece disappears from a case file.
   */
  groups: YearGroup<T>[];
  undatedCount: number;
  /** Documents in, documents out. `total === sum of group sizes` always. */
  total: number;
}

/**
 * Groups the chronology by year, PRESERVING the incoming order (the timeline endpoint already
 * sorts `timeline_date ASC NULLS LAST`, and the rails have to line up with the rows the user sees,
 * so this must not re-sort).
 *
 * A year appears at most once: an out-of-order document joins the group its year already has
 * rather than opening a second "1995" rail further down.
 */
export function groupByYear<T extends Pick<InsightDocument, "timelineDate">>(
  docs: readonly T[]
): YearGrouping<T> {
  const byYear = new Map<string, T[]>();
  const order: string[] = [];
  const undated: T[] = [];

  for (const doc of docs) {
    const year = yearOf(doc);
    if (!year) {
      undated.push(doc);
      continue;
    }
    const bucket = byYear.get(year);
    if (bucket) bucket.push(doc);
    else {
      byYear.set(year, [doc]);
      order.push(year);
    }
  }

  const groups: YearGroup<T>[] = order.map((year) => ({
    kind: "year",
    year,
    documents: byYear.get(year) as T[]
  }));
  // Only when there are any: an empty rail labelled "Sans date" is noise.
  if (undated.length > 0) groups.push({ kind: "undated", documents: undated });

  return { groups, undatedCount: undated.length, total: docs.length };
}

// ---------------------------------------------------------------------------------------------
// Co-mention graph
// ---------------------------------------------------------------------------------------------

/**
 * The key a person is counted under: whitespace collapsed, case folded, diacritics stripped.
 *
 * WHAT THIS FOLDS, AND WHY THAT IS SAFE. Only spellings with the same letters in the same order
 * collapse — "Monique PIRSON" into "Monique Pirson", "Étienne Pirson" into "Etienne Pirson". Two
 * renderings of one string are not two people, and the summarizer emits both forms freely because a
 * filing's own typography varies (a 1992 inventory shouts surnames, a 1989 letter does not).
 * Measured on this case file, NOT folding cost real accuracy: Monique appeared as 2 spellings across
 * 38 documents, Étienne as 3 across 24 — and because the graph caps at the top 12 names, the variant
 * nodes were dropped, so the undercount was invisible rather than "honest and visible".
 *
 * WHAT IT STILL REFUSES. "Sparenberg" is not merged into "Ghislaine Sparenberg", "M. Pirson" not
 * into "Monique Pirson", "Pirson, Monique" not reordered. Those are guesses, and among five siblings
 * sharing a surname a wrong merge invents a person's involvement in a filing. Aliasing beyond
 * letter-identity belongs in a map she can see and correct, not in this function.
 */
export function personKey(raw: string): string {
  return (
    collapseWhitespace(raw)
      .toLowerCase()
      // NFD splits a letter from its accent so the combining marks can be dropped on their own.
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
  );
}

/** Display form: whitespace only, so the name is shown as the document wrote it. */
export function normalizePersonName(raw: string): string {
  return collapseWhitespace(raw);
}

export interface RelationNode {
  /** The normalised name; also the node id, since a name is all key_names gives us. */
  id: string;
  name: string;
  /** How many documents name this person — the node's size. */
  documentCount: number;
  /** Those documents, in corpus order: what clicking the node filters the list to. */
  documentIds: string[];
}

/**
 * A CO-MENTION between two people: they are named in the same `weight` documents. Nothing more.
 *
 * `source`/`target` are ordered ONLY so each unordered pair is emitted exactly once; they carry no
 * direction and must never be rendered as an arrow or read as "gave to". key_names proves that two
 * names appear in the same file — it says nothing about who transmitted what to whom, which in a
 * succession dispute is the fact that decides the shares. Directed transmissions require the
 * page-level extraction pass, which has not run.
 */
export interface RelationEdge {
  /** personKey of each endpoint — a fold, not a display string. Use sourceName/targetName in the UI. */
  source: string;
  target: string;
  /** The spelling to render for each endpoint. */
  sourceName: string;
  targetName: string;
  /** Number of documents naming BOTH people. */
  weight: number;
  /** Those documents, in corpus order: what clicking the edge filters the list to. */
  documentIds: string[];
}

export interface RelationGraph {
  /** Included people, most-documented first. radialLayout consumes this order. */
  nodes: RelationNode[];
  /** Kept co-mentions, strongest first. Endpoints are always present in `nodes`. */
  edges: RelationEdge[];
  /** Distinct normalised names found, before any capping — for an honest "12 of 34" label. */
  totalPeople: number;
  /** People dropped by `minNodeDocuments` or `maxNodes`. */
  omittedNodeCount: number;
  /** Co-mentions between included people dropped by `minEdgeWeight`. */
  omittedEdgeCount: number;
}

export interface RelationGraphOptions {
  /** Keep only the N most-documented people. */
  maxNodes?: number;
  /** Drop co-mentions weaker than this many shared documents. */
  minEdgeWeight?: number;
  /** Drop people named in fewer than this many documents. */
  minNodeDocuments?: number;
}

/**
 * Defaults measured against this case file: 12 people recur (the seven Pirson/Sparenberg family
 * members plus five professionals), the top of them share 20+ documents each, and every pair of
 * them co-occurs somewhere. Uncapped that is 66 edges over 12 nodes — a hairball that says
 * "everyone is connected to everyone", i.e. nothing. A single shared document is also the weakest
 * possible signal, hence minEdgeWeight 2.
 */
export const DEFAULT_RELATION_GRAPH_OPTIONS = {
  maxNodes: 12,
  minEdgeWeight: 2,
  minNodeDocuments: 2
} as const;

/**
 * Derives the co-mention graph from the documents already in state — no endpoint, because the
 * client already holds every key_names array it needs.
 *
 * Cost is O(documents x names-per-document^2): 55 documents naming ~10 people each is a few
 * thousand increments, well under a frame. The ceiling is roughly a few thousand documents or
 * documents naming dozens of people (the squared term), at which point this belongs in SQL as a
 * self-join on key_names rather than in a render path.
 */
export function buildRelationGraph(
  docs: readonly Pick<InsightDocument, "id" | "keyNames">[],
  options: RelationGraphOptions = {}
): RelationGraph {
  const maxNodes = options.maxNodes ?? DEFAULT_RELATION_GRAPH_OPTIONS.maxNodes;
  const minEdgeWeight =
    options.minEdgeWeight ?? DEFAULT_RELATION_GRAPH_OPTIONS.minEdgeWeight;
  const minNodeDocuments =
    options.minNodeDocuments ?? DEFAULT_RELATION_GRAPH_OPTIONS.minNodeDocuments;

  // Pass 1: people -> the documents naming them, plus each document's deduped key list. Counting is
  // by personKey (case- and accent-folded), so "Monique PIRSON" and "Monique Pirson" are one person;
  // the spellings themselves are tallied so the one the documents use most is what gets displayed.
  const documentsByPerson = new Map<string, string[]>();
  const spellings = new Map<string, Map<string, number>>();
  const keysByDocument: string[][] = [];
  for (const doc of docs) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const raw of doc.keyNames) {
      const display = normalizePersonName(raw);
      const key = personKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      const list = documentsByPerson.get(key);
      if (list) list.push(doc.id);
      else documentsByPerson.set(key, [doc.id]);
      const forms = spellings.get(key) ?? new Map<string, number>();
      forms.set(display, (forms.get(display) ?? 0) + 1);
      spellings.set(key, forms);
    }
    keysByDocument.push(keys);
  }

  /** The spelling the corpus uses most, ties broken by code unit so the label never flickers. */
  const displayName = (key: string): string => {
    const forms = spellings.get(key);
    if (!forms) return key;
    return [...forms.entries()].sort(
      (a, b) => b[1] - a[1] || compareStrings(a[0], b[0])
    )[0][0];
  };

  const totalPeople = documentsByPerson.size;
  const ranked = Array.from(documentsByPerson.entries())
    .map(([key, documentIds]) => ({
      id: key,
      name: displayName(key),
      documentCount: documentIds.length,
      documentIds
    }))
    .filter((node) => node.documentCount >= minNodeDocuments)
    .sort(
      (a, b) => b.documentCount - a.documentCount || compareStrings(a.id, b.id)
    );
  const nodes = ranked.slice(0, maxNodes);
  const included = new Set(nodes.map((node) => node.id));

  // Pass 2: edges among INCLUDED people only, so no edge can point at a node the view never draws.
  const byPair = new Map<string, RelationEdge>();
  keysByDocument.forEach((keys, index) => {
    // Sorting the document's keys makes the pair orientation (source < target) fall out for free,
    // which is what guarantees each unordered pair is counted once instead of twice.
    const present = keys
      .filter((key) => included.has(key))
      .sort(compareStrings);
    for (let a = 0; a < present.length; a++) {
      for (let b = a + 1; b < present.length; b++) {
        // JSON, not a joined string: a name legitimately contains spaces, so "A B" + "C" and
        // "A" + "B C" would key to the same pair and silently merge two relationships.
        const key = JSON.stringify([present[a], present[b]]);
        const edge = byPair.get(key) ?? {
          source: present[a],
          target: present[b],
          // Carried on the edge so a label never has to render a folded key: personKey is lowercase
          // and unaccented, so "monique pirson" would reach the UI without these.
          sourceName: displayName(present[a]),
          targetName: displayName(present[b]),
          weight: 0,
          documentIds: []
        };
        edge.weight += 1;
        edge.documentIds.push(docs[index].id);
        byPair.set(key, edge);
      }
    }
  });

  const edges = Array.from(byPair.values())
    .filter((edge) => edge.weight >= minEdgeWeight)
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        compareStrings(a.source, b.source) ||
        compareStrings(a.target, b.target)
    );

  return {
    nodes,
    edges,
    totalPeople,
    omittedNodeCount: totalPeople - nodes.length,
    omittedEdgeCount: byPair.size - edges.length
  };
}

// ---------------------------------------------------------------------------------------------
// Radial layout
// ---------------------------------------------------------------------------------------------

export interface RelationLayoutNode {
  id: string;
  /** Centre of the node, in the same units as `size` (an SVG viewBox of size x size). */
  x: number;
  y: number;
  /** Circle radius, scaled by document count. */
  r: number;
}

export interface RelationLayout {
  size: number;
  center: { x: number; y: number };
  /** Radius of the circle the node centres sit on. */
  radius: number;
  nodes: RelationLayoutNode[];
  /** Same nodes keyed by id, so drawing an edge is two O(1) lookups. */
  byId: Record<string, RelationLayoutNode>;
}

export interface RadialLayoutOptions {
  padding?: number;
  minNodeRadius?: number;
  maxNodeRadius?: number;
}

/** Two decimals is plenty for SVG and keeps the numbers identical across platforms. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Places nodes evenly around a circle in the order given (buildRelationGraph orders them by
 * document count), starting at twelve o'clock and going clockwise.
 *
 * Deterministic by construction: pure trigonometry over the node index, no simulation. A force
 * layout would settle differently on every mount, so the same case file would look like a
 * different graph each visit and nothing could be found twice — which also rules out testing it.
 */
export function radialLayout(
  nodes: readonly RelationNode[],
  size: number,
  options: RadialLayoutOptions = {}
): RelationLayout {
  const padding = options.padding ?? 24;
  const minNodeRadius = options.minNodeRadius ?? 6;
  const maxNodeRadius = options.maxNodeRadius ?? 22;

  const center = { x: round2(size / 2), y: round2(size / 2) };
  // The ring is pulled in by the largest node's radius, otherwise the biggest circle — the most
  // important person — is the one clipped by the viewBox.
  const radius = Math.max(0, size / 2 - padding - maxNodeRadius);
  const maxCount = nodes.reduce(
    (max, node) => Math.max(max, node.documentCount),
    0
  );

  const laidOut = nodes.map((node, index) => {
    // sqrt because the eye reads a circle's AREA, not its radius: scaling the radius linearly
    // makes a 36-document person look ~36x heavier than a 1-document one instead of 6x.
    const scale = maxCount > 0 ? Math.sqrt(node.documentCount / maxCount) : 0;
    const r = round2(minNodeRadius + (maxNodeRadius - minNodeRadius) * scale);
    // A lone node has no circle to sit on; it belongs in the middle.
    if (nodes.length === 1) return { id: node.id, x: center.x, y: center.y, r };
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / nodes.length;
    return {
      id: node.id,
      x: round2(center.x + radius * Math.cos(angle)),
      y: round2(center.y + radius * Math.sin(angle)),
      r
    };
  });

  const byId: Record<string, RelationLayoutNode> = {};
  for (const node of laidOut) byId[node.id] = node;
  return { size, center, radius: round2(radius), nodes: laidOut, byId };
}

/**
 * How strongly to draw an edge, 0.15..1 relative to the strongest one — the view maps it to stroke
 * width and opacity. Floored rather than starting at 0 so the weakest kept co-mention is still
 * visible: an edge that has passed minEdgeWeight is a fact, and drawing it invisibly hides it.
 */
export function edgeStrength(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, weight / maxWeight));
  return round2(0.15 + 0.85 * ratio);
}

export function maxEdgeWeight(edges: readonly RelationEdge[]): number {
  return edges.reduce((max, edge) => Math.max(max, edge.weight), 0);
}

// ---------------------------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------------------------

/**
 * True only for lifecycle_state 'archived' — never `!== "active"`. Ingestion parks byte-identical
 * duplicates at 'superseded', and those are duplicates the system found, not documents she chose
 * to archive; lumping them together would make the archive shelf lie about what is in it.
 */
export function isArchived(
  doc: Pick<InsightDocument, "lifecycleState">
): boolean {
  return doc.lifecycleState === "archived";
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** The fields the search box reads. */
export type SearchableDocument = Pick<
  InsightDocument,
  "filename" | "timelineDate" | "tags" | "keyNames"
>;

/**
 * Matches what a lawyer actually remembers about a document: its name, a party, a topic, or
 * roughly when it is from — the four fields the search placeholder promises. Substring, not fuzzy:
 * a filter whose result she cannot predict is one she cannot trust a bulk action to.
 */
export function matchesDocumentQuery(
  doc: SearchableDocument,
  query: string
): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return (
    doc.filename.toLowerCase().includes(needle) ||
    (doc.timelineDate ?? "").includes(needle) ||
    doc.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
    doc.keyNames.some((name) => name.toLowerCase().includes(needle))
  );
}

/**
 * Which of the three shelves a document belongs to. Mutually exclusive and exhaustive, so a
 * document is always on exactly one and none can be lost between them.
 *
 *  case     — the case file: what she filed and what the assistant can retrieve.
 *  pending  — not part of the file yet: a presign stub whose bytes never arrived, or a parse that
 *             failed. These are chores (retry, discard), not evidence.
 *  archived — removed from search and chat by hand, kept and restorable.
 *
 * The split is not cosmetic. Measured on the real corpus: the un-archived list is 122 rows, of which
 * 50 are awaiting_upload stubs and 6 failed — and 56 of the 69 undated rows are exactly those. Mixed
 * into one chronology they bury the 56 real documents and turn "Sans date" into the largest group in
 * the case file. Split, the chronology is 56 rows with 3 undated.
 */
export type DocumentShelf = "case" | "pending" | "archived";

/** parse_status values that mean the document is not part of the case file. */
const PENDING_STATUSES: ReadonlySet<LexParseStatus> = new Set([
  "awaiting_upload",
  "failed"
]);

export function shelfOf(
  doc: Pick<InsightDocument, "lifecycleState" | "parseStatus">
): DocumentShelf {
  // Archived wins: she asked for it explicitly, whatever the parse status underneath.
  if (isArchived(doc)) return "archived";
  return PENDING_STATUSES.has(doc.parseStatus) ? "pending" : "case";
}

export interface DocumentFilter {
  query?: string;
  /** Omitted means the case file — the shelf a document belongs to by default. */
  shelf?: DocumentShelf;
  /**
   * Restrict to these document ids — how a graph node or edge click narrows the list. Undefined
   * means no restriction; an EMPTY array means nothing matches, which is a real answer (a person
   * with no documents left after the other filters) and not "ignore me".
   */
  documentIds?: readonly string[];
}

/**
 * The one place the visible list is decided. The view must derive its rows, its select-all and its
 * bulk actions from this same array: a select-all computed over anything wider than what the user
 * can see would let one click archive documents the filter is hiding.
 *
 * Incoming order is preserved (the timeline endpoint is already chronological).
 */
export function filterDocuments<
  T extends SearchableDocument &
    Pick<InsightDocument, "id" | "lifecycleState" | "parseStatus">
>(docs: readonly T[], filter: DocumentFilter = {}): T[] {
  const allowed = filter.documentIds ? new Set(filter.documentIds) : null;
  const shelf = filter.shelf ?? "case";
  return docs.filter(
    (doc) =>
      shelfOf(doc) === shelf &&
      (!allowed || allowed.has(doc.id)) &&
      matchesDocumentQuery(doc, filter.query ?? "")
  );
}

/** How many documents sit on each shelf, for the toggle's counts. */
export function countByShelf(
  docs: readonly Pick<InsightDocument, "lifecycleState" | "parseStatus">[]
): Record<DocumentShelf, number> {
  const counts: Record<DocumentShelf, number> = {
    case: 0,
    pending: 0,
    archived: 0
  };
  for (const doc of docs) counts[shelfOf(doc)]++;
  return counts;
}

/** Documents whose ids are in `ids`, in the list's own order (not in `ids` order). */
export function pickDocumentsByIds<T extends Pick<InsightDocument, "id">>(
  docs: readonly T[],
  ids: readonly string[]
): T[] {
  const wanted = new Set(ids);
  return docs.filter((doc) => wanted.has(doc.id));
}

// ---------------------------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------------------------

export interface SelectionState {
  /** Membership is what matters; the order is insertion order and carries no meaning. */
  selectedIds: string[];
  /** The last row clicked without shift — where a shift-click ranges from. */
  anchorId: string | null;
}

export const EMPTY_SELECTION: SelectionState = {
  selectedIds: [],
  anchorId: null
};

/**
 * The ids between two rows of the VISIBLE list, inclusive.
 *
 * Operating on the visible (filtered, ordered) list rather than the raw array is the entire point:
 * ranging over the unfiltered array would sweep in documents the search is hiding.
 *
 * The two degenerate cases are the classic shift-click bugs:
 *  - the anchor has been filtered away since it was set (the search changed, the archive shelf was
 *    toggled). indexOf returns -1, and treating -1 as an index would select the whole head of the
 *    list. The range collapses to the clicked row instead.
 *  - the target precedes the anchor. Dragging upwards is as normal as downwards, so the endpoints
 *    are sorted rather than assumed.
 */
export function resolveSelectionRange(
  visibleIds: readonly string[],
  anchorId: string | null | undefined,
  targetId: string
): string[] {
  const target = visibleIds.indexOf(targetId);
  if (target === -1) return [];
  if (!anchorId) return [visibleIds[target]];
  const anchor = visibleIds.indexOf(anchorId);
  if (anchor === -1) return [visibleIds[target]];
  const from = Math.min(anchor, target);
  const to = Math.max(anchor, target);
  return visibleIds.slice(from, to + 1);
}

/**
 * The next selection after a click on `clickedId`.
 *
 * - plain click and cmd/ctrl-click both TOGGLE the row, and move the anchor to it. They are the
 *   same operation here because the rows are a selectable list, not a navigation target: a plain
 *   click that cleared the rest would throw away a selection built one shift-click earlier.
 * - shift-click UNIONS the range from the anchor into the selection and leaves the anchor where it
 *   is, so successive shift-clicks widen and narrow from the same origin. Union, not replace:
 *   nothing a user has ticked is silently untucked by a shift-click.
 */
export function nextSelection(
  state: SelectionState,
  visibleIds: readonly string[],
  clickedId: string,
  modifiers: { shift?: boolean; meta?: boolean } = {}
): SelectionState {
  if (modifiers.shift) {
    const range = resolveSelectionRange(visibleIds, state.anchorId, clickedId);
    const selectedIds = state.selectedIds.slice();
    const known = new Set(selectedIds);
    for (const id of range) {
      if (known.has(id)) continue;
      known.add(id);
      selectedIds.push(id);
    }
    // Keep the anchor only while it is still on screen; a stale one would range from nowhere.
    const anchorStillVisible =
      state.anchorId !== null && visibleIds.includes(state.anchorId);
    return {
      selectedIds,
      anchorId: anchorStillVisible ? state.anchorId : clickedId
    };
  }

  const isSelected = state.selectedIds.includes(clickedId);
  return {
    selectedIds: isSelected
      ? state.selectedIds.filter((id) => id !== clickedId)
      : [...state.selectedIds, clickedId],
    anchorId: clickedId
  };
}

export interface SelectionSummary {
  /** Everything selected, including rows the current filter hides. */
  count: number;
  /** Selected AND visible, in visible order — what a bulk action scoped to the filter should use. */
  visibleSelectedIds: string[];
  /**
   * Selected but hidden by the current filter right now. Non-zero means a bulk action would reach
   * documents the user cannot see, which the selection bar has to say out loud.
   */
  hiddenSelectedCount: number;
  allVisibleSelected: boolean;
  /** Some but not all — the indeterminate state of the select-all checkbox. */
  someVisibleSelected: boolean;
}

/**
 * Drops ids from a selection — for rows that have LEFT the list, not for un-ticking.
 *
 * A selection that outlives its documents makes the scope warning lie, and that warning is the only
 * thing standing between a bulk action and the rows a filter is hiding: delete a selected row and
 * `selectionSummary` still counts it, so the bar reads "2 sélectionnés" over one document and warns
 * about "1 masqué par le filtre" for a document that no longer exists anywhere. A warning that cries
 * wolf is worse than none, because the next real one is ignored.
 *
 * The anchor goes too when it is one of the dropped ids: a shift-click ranging from a row that is
 * gone has no defined meaning.
 */
export function deselect(
  state: SelectionState,
  ids: readonly string[]
): SelectionState {
  const dropped = new Set(ids);
  if (!state.selectedIds.some((id) => dropped.has(id))) {
    // Still clear a stale anchor even when nothing was selected — it can point at a deleted row.
    return state.anchorId && dropped.has(state.anchorId)
      ? { ...state, anchorId: null }
      : state;
  }
  return {
    selectedIds: state.selectedIds.filter((id) => !dropped.has(id)),
    anchorId:
      state.anchorId && dropped.has(state.anchorId) ? null : state.anchorId
  };
}

/**
 * What the selection bar needs to describe itself honestly. `visibleSelectedIds` and
 * `hiddenSelectedCount` exist so "Tout sélectionner (12 filtrés)" can be truthful about scope: a
 * bare count that mixes visible and hidden rows is how a bulk action ends up hitting a document
 * the search was hiding.
 */
export function selectionSummary(
  selectedIds: readonly string[],
  visibleIds: readonly string[]
): SelectionSummary {
  const selected = new Set(selectedIds);
  const visibleSelectedIds = visibleIds.filter((id) => selected.has(id));
  return {
    count: selected.size,
    visibleSelectedIds,
    hiddenSelectedCount: selected.size - visibleSelectedIds.length,
    allVisibleSelected:
      visibleIds.length > 0 && visibleSelectedIds.length === visibleIds.length,
    someVisibleSelected:
      visibleSelectedIds.length > 0 &&
      visibleSelectedIds.length < visibleIds.length
  };
}

// ---------------------------------------------------------------------------------------------
// Key events
// ---------------------------------------------------------------------------------------------

/**
 * Abbreviations whose period does NOT end a sentence, in the French and Dutch a Belgian filing
 * actually uses. A length threshold was tried first and is wrong in both directions: "Acte de
 * partage devant notaire Mahieux." is a complete 39-character sentence, while "M. Pirson invoque
 * l'art. 843" carries two abbreviated periods in its first 25. Only the token itself tells you.
 */
const SENTENCE_ABBREVIATIONS = new Set([
  "m",
  "mm",
  "mme",
  "mmes",
  "mlle",
  "me",
  "mes",
  "dr",
  "prof",
  "art",
  "artt",
  "al",
  "no",
  "nr",
  "pp",
  "ed",
  "éd",
  "etc",
  "cf",
  "vs",
  "ann",
  "av",
  "dhr",
  "mevr",
  "blz",
  "resp",
  "bv",
  "nv",
  "sa",
  "sprl"
]);

/** Whether the terminator at `index` really closes a sentence, or is an abbreviation's period. */
function endsSentence(text: string, index: number): boolean {
  // Only a period is ambiguous; "!", "?" and "…" never abbreviate anything.
  if (text[index] !== ".") return true;
  const token = /([\p{L}\p{N}]+)$/u.exec(text.slice(0, index))?.[1] ?? "";
  if (!token) return true;
  // A lone letter is an initial — "J. Pirson", "A. Pirson" — never a sentence.
  if (/^\p{L}$/u.test(token)) return false;
  return !SENTENCE_ABBREVIATIONS.has(token.toLowerCase());
}

/**
 * The first sentence of a summary, for a one-line event row. Falls back to a word-boundary
 * truncation when the text never closes a sentence within `maxLength`.
 */
export function firstSentence(text: string, maxLength = 160): string {
  const clean = collapseWhitespace(text);
  if (!clean) return "";
  const terminator = /[.!?…](\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = terminator.exec(clean)) !== null) {
    if (!endsSentence(clean, match.index)) continue;
    const end = match.index + 1;
    if (end <= maxLength) return clean.slice(0, end);
    break;
  }
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

export interface KeyEvent {
  documentId: string;
  filename: string;
  /**
   * null when the document has no extracted timeline_date. v1 emits ONE event per document, so a
   * bundle like "pièces 1 à 12" holding several dons manuels at different dates appears as a
   * single point — the UI has to say so, because a chronology that looks complete and is not is
   * worse than one that admits its granularity.
   */
  date: string | null;
  /** One line drawn from the summary; empty when the document has none yet. */
  line: string;
  /** Normalised key_names, in the document's own order. */
  people: string[];
}

export interface KeyEventList {
  /** Dated events oldest-first, then the undated ones — never dropped, only moved to the end. */
  events: KeyEvent[];
  datedCount: number;
  undatedCount: number;
  /**
   * The person filter's options, most-mentioned first. Folded by personKey, so "Bernadette PIRSON"
   * and "Bernadette Pirson" are ONE option rather than two indistinguishable ones — picking the
   * wrong near-duplicate silently returned 1 event where the person has 23. The count travels with
   * the option so the choice is informed.
   */
  people: KeyEventPerson[];
}

export interface KeyEventPerson {
  /** personKey — what filterKeyEventsByPerson matches on. */
  key: string;
  /** The spelling the documents use most, for the option label. */
  name: string;
  /** How many events name this person, in any spelling. */
  eventCount: number;
}

/** The fields one key event is built from. */
export type EventDocument = Pick<
  InsightDocument,
  "id" | "filename" | "timelineDate" | "summary" | "keyNames"
>;

/**
 * Builds the key-events list.
 *
 * Unlike groupByYear, this DOES sort: the dialog is a standalone chronology rather than a set of
 * rails that must line up with the rows behind them, so it should read oldest-first whatever order
 * it was handed. Undated documents go last (undated, not ancient) and are counted, so the dialog
 * can offer them instead of quietly leaving them out.
 */
export function buildKeyEvents(docs: readonly EventDocument[]): KeyEventList {
  const events = docs.map((doc, index) => ({
    index,
    event: {
      documentId: doc.id,
      filename: doc.filename,
      date: doc.timelineDate ?? null,
      line: firstSentence(doc.summary ?? ""),
      people: Array.from(
        new Set(doc.keyNames.map(normalizePersonName).filter(Boolean))
      )
    } satisfies KeyEvent
  }));

  events.sort((a, b) => {
    const ad = a.event.date;
    const bd = b.event.date;
    if (!ad && !bd) return a.index - b.index;
    if (!ad) return 1;
    if (!bd) return -1;
    return compareStrings(ad, bd) || a.index - b.index;
  });

  const ordered = events.map((entry) => entry.event);
  const undatedCount = ordered.filter((event) => !event.date).length;

  // Folded tally: one entry per person, whatever the filing's typography, with the spellings counted
  // so the label is the one the corpus actually uses.
  const mentions = new Map<string, number>();
  const spellings = new Map<string, Map<string, number>>();
  for (const event of ordered) {
    const seen = new Set<string>();
    for (const person of event.people) {
      const key = personKey(person);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mentions.set(key, (mentions.get(key) ?? 0) + 1);
      const forms = spellings.get(key) ?? new Map<string, number>();
      forms.set(person, (forms.get(person) ?? 0) + 1);
      spellings.set(key, forms);
    }
  }
  const people: KeyEventPerson[] = Array.from(mentions.entries())
    .map(([key, eventCount]) => ({
      key,
      name: [...(spellings.get(key) ?? new Map())].sort(
        (a, b) => b[1] - a[1] || compareStrings(a[0], b[0])
      )[0][0],
      eventCount
    }))
    .sort(
      (a, b) => b.eventCount - a.eventCount || compareStrings(a.key, b.key)
    );

  return {
    events: ordered,
    datedCount: ordered.length - undatedCount,
    undatedCount,
    people
  };
}

/** Events naming exactly this person (normalised, exact match — see normalizePersonName). */
export function filterKeyEventsByPerson(
  events: readonly KeyEvent[],
  person: string | null | undefined
): KeyEvent[] {
  if (!person) return events.slice();
  // Matched on the fold, so selecting "Bernadette Pirson" also returns the filings that shout it.
  const wanted = personKey(person);
  return events.filter((event) =>
    event.people.some((name) => personKey(name) === wanted)
  );
}
