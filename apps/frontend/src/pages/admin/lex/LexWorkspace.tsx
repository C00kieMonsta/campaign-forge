import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LexDocument, LexWorkspace } from "@packages/types";
import { Button, Input } from "@packages/ui";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarClock,
  Eye,
  FileSignature,
  FileText,
  Inbox,
  Loader2,
  MessageSquare,
  Network,
  Rows3,
  Search,
  Trash2,
  Undo2,
  Upload,
  X
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import DocumentViewerDialog from "@/components/lex/DocumentViewerDialog";
import RelationsGraph, {
  type RelationSelection
} from "@/components/lex/RelationsGraph";
import { useLanguage } from "@/contexts/LanguageContext";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  buildRelationGraph,
  countByShelf,
  countTagFrequencies,
  deselect,
  EMPTY_SELECTION,
  filterDocuments,
  groupByYear,
  isArchived,
  nextSelection,
  rankTagsWithFrequencies,
  selectionSummary,
  type DocumentShelf,
  type RelationEdge,
  type RelationNode,
  type SelectionState
} from "@/lib/documentInsights";
import { toUploadCandidates, uploadDocuments } from "@/lib/uploadDocuments";
import { cn } from "@/lib/utils";

const IN_PROGRESS: ReadonlySet<LexDocument["parseStatus"]> = new Set([
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "summarizing"
]);

type Density = "dense" | "comfortable";

type Dv = ReturnType<typeof useLanguage>["t"]["lex"]["docsView"];
type T = ReturnType<typeof useLanguage>["t"];

/**
 * The three shelves, in the order they are offered. Declared as data rather than three copies of the
 * same button so a fourth shelf cannot be added in one place and forgotten in the heading map below.
 */
const SHELVES: {
  key: DocumentShelf;
  icon: typeof Archive;
  label: (dv: Dv, t: T) => string;
}[] = [
  { key: "case", icon: FileText, label: (_dv, t) => t.lex.timeline },
  { key: "pending", icon: Inbox, label: (dv) => dv.pendingShelf },
  { key: "archived", icon: Archive, label: (dv) => dv.showArchived }
];

const SHELF_HEADINGS: Record<DocumentShelf, (dv: Dv, t: T) => string> = {
  case: (_dv, t) => t.lex.timeline,
  pending: (dv) => dv.pendingShelf,
  archived: (dv) => dv.showArchived
};

// Persisted: which density she wants is a property of her screen and her habit, not of a visit.
const DENSITY_KEY = "lex_documents_density";
const RELATIONS_KEY = "lex_documents_relations";

// How many tags a row shows, rarest-across-the-corpus first. Capped because the tail is noise:
// 'succession' sits on 28 of these 55 documents and 'Belgique' on 21, so past the first few the row
// repeats what the whole file already says instead of what THIS document is. Dense rows get fewer
// still — the point of dense is one line per document.
const DENSE_TAG_LIMIT = 3;
const COMFORTABLE_TAG_LIMIT = 5;

/** What a graph click narrowed the list to: the ids to filter by, and how to say so on screen. */
interface GraphFocus {
  selection: RelationSelection;
  documentIds: string[];
  label: string;
}

const StatusBadge = memo(function StatusBadge({
  status
}: {
  status: LexDocument["parseStatus"];
}) {
  const base =
    "text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1";
  if (status === "ready")
    return <span className={`${base} bg-green-100 text-green-700`}>ready</span>;
  if (status === "failed")
    return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  if (status === "needs_ocr")
    return (
      <span className={`${base} bg-amber-100 text-amber-700`}>needs OCR</span>
    );
  return (
    <span className={`${base} bg-blue-100 text-blue-700`}>
      <Loader2 className="h-3 w-3 animate-spin" />
      {status}
    </span>
  );
});

/**
 * One document. Clicking anywhere on the row toggles its selection (cmd/ctrl toggles one, shift
 * ranges from the anchor), so every inner control has to stopPropagation or a tag click would also
 * tick the row.
 */
function DocumentRow({
  doc,
  tags,
  density,
  selected,
  showCheckbox,
  archived,
  labels,
  onRowClick,
  onTagClick,
  onOpen,
  onRestore,
  onDelete
}: {
  doc: LexDocument;
  tags: string[];
  density: Density;
  selected: boolean;
  /** Once anything is selected the checkboxes stay put; otherwise they appear on hover. */
  showCheckbox: boolean;
  archived: boolean;
  labels: {
    select: string;
    restore: string;
    archivedBadge: string;
    delete: string;
    view: string;
    searchHint: string;
    noDate: string;
  };
  onRowClick: (e: React.MouseEvent) => void;
  onTagClick: (tag: string) => void;
  onOpen: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const dense = density === "dense";

  // `readOnly` and no onChange on purpose: the click bubbles to the row, which is the single place
  // the toggle is decided, because only a MouseEvent carries shiftKey/metaKey. A change handler here
  // would fire in addition to the row's and toggle the row twice.
  const checkbox = (
    <input
      type="checkbox"
      checked={selected}
      readOnly
      aria-label={`${labels.select} ${doc.filename}`}
      className={
        showCheckbox || selected
          ? "shrink-0"
          : "shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }
    />
  );

  const tagRow =
    tags.length > 0 ? (
      <div
        className={dense ? "flex gap-1 min-w-0" : "mt-2 flex flex-wrap gap-1"}
      >
        {tags.map((tag) => (
          <button
            key={tag}
            onClick={(e) => {
              e.stopPropagation();
              onTagClick(tag);
            }}
            title={labels.searchHint}
            className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground max-w-[10rem] truncate"
          >
            {tag}
          </button>
        ))}
      </div>
    ) : null;

  const actions = (
    <div className="flex items-center gap-2 shrink-0">
      {archived ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {labels.archivedBadge}
        </span>
      ) : null}
      <StatusBadge status={doc.parseStatus} />
      {doc.parseStatus !== "awaiting_upload" ? (
        <button
          onClick={(e) => {
            // The row owns click-to-select, so every action button stops propagation or opening a
            // document would also tick it.
            e.stopPropagation();
            onOpen();
          }}
          aria-label={labels.view}
          title={labels.view}
          className="text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-4 w-4" />
        </button>
      ) : null}
      {archived ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
          aria-label={labels.restore}
          title={labels.restore}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArchiveRestore className="h-4 w-4" />
        </button>
      ) : null}
      {/* Permanent deletion, unchanged and still one document at a time. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={labels.delete}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <li
      onClick={onRowClick}
      // A shift-click would otherwise select the page's text instead of the range.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      className={
        selected
          ? "group ml-4 cursor-pointer rounded-xl border border-primary/40 bg-primary/5"
          : "group ml-4 cursor-pointer rounded-xl border bg-card hover:border-muted-foreground/30"
      }
    >
      {/* The chronology's dot. Absolutely positioned against the rail (the nearest positioned
          ancestor), with no `top`, so it keeps its static position within this row. */}
      <span
        className={
          dense
            ? "absolute -left-1.5 mt-3 h-3 w-3 rounded-full bg-sidebar-primary"
            : "absolute -left-1.5 mt-5 h-3 w-3 rounded-full bg-sidebar-primary"
        }
      />
      {dense ? (
        <div className="flex items-center gap-3 px-3 py-2 min-w-0">
          {checkbox}
          <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
            {doc.timelineDate ?? labels.noDate}
          </span>
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate flex-1 min-w-0">
            {doc.filename}
          </span>
          <div className="hidden md:flex">{tagRow}</div>
          {actions}
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="pt-1">{checkbox}</span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  {doc.timelineDate ?? labels.noDate}
                </div>
                <div className="font-medium flex items-center gap-2 truncate">
                  <FileText className="h-4 w-4 shrink-0" />
                  {doc.filename}
                </div>
              </div>
            </div>
            {actions}
          </div>
          {doc.summary ? (
            <p className="text-sm text-muted-foreground mt-2">{doc.summary}</p>
          ) : doc.parseStatus === "failed" && doc.error ? (
            <p className="text-sm text-destructive mt-2">{doc.error}</p>
          ) : null}
          {tagRow}
        </div>
      )}
    </li>
  );
}

/**
 * The workspace's documents: a chronology of everything filed, with multi-select, a reversible
 * archive, a co-mention graph over the people named in them, and the chronology as key events.
 *
 * State stays local (useState + direct api calls) rather than moving to the normalized store, so
 * the ordered `timeline` endpoint keeps deciding the order — the store's useCollection returns a map
 * in insertion order and would mean re-sorting here. The cost is that archiving in this view does
 * not update the chat's document panel until that panel reloads.
 *
 * Every derivation lives in @/lib/documentInsights, which is pure and unit-tested: this file only
 * wires it up. In particular the visible list, the select-all and the bulk actions all come from the
 * same filterDocuments call, which is what stops a bulk action reaching a document the search hides.
 */
export default function LexWorkspace() {
  const { id = "" } = useParams();
  const { t } = useLanguage();
  const dv = t.lex.docsView;
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [workspace, setWorkspace] = useState<LexWorkspace | null>(null);
  const [docs, setDocs] = useState<LexDocument[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [shelf, setShelf] = useState<DocumentShelf>("case");
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  /** The ids the last archive actually moved — exactly what Undo replays, and nothing else. */
  const [lastArchived, setLastArchived] = useState<string[] | null>(null);
  /** The document shown in the read-only PDF viewer, or null. Same dialog as the chat view. */
  const [viewerDoc, setViewerDoc] = useState<LexDocument | null>(null);

  const [density, setDensity] = useLocalStorage<Density>(
    DENSITY_KEY,
    "comfortable"
  );
  const [showRelations, setShowRelations] = useLocalStorage(
    RELATIONS_KEY,
    true
  );

  // `include` so one fetch holds both shelves: archiving then becomes a local lifecycleState patch
  // and its Undo another, instead of two round-trips during which the row she just archived is still
  // on screen. filterDocuments splits the shelves client-side. 55 documents makes this free.
  const loadTimeline = useCallback(async () => {
    const { items } = await api.lex.workspaces.timeline(id, "include");
    setDocs(items);
    return items;
  }, [id]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { workspace: ws } = await api.lex.workspaces.get(id);
      setWorkspace(ws);
      await loadTimeline();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [id, loadTimeline, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll the timeline while any document is still being ingested.
  useEffect(() => {
    const anyInProgress = docs.some((doc) => IN_PROGRESS.has(doc.parseStatus));
    if (anyInProgress && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const items = await loadTimeline();
          if (
            !items.some((doc) => IN_PROGRESS.has(doc.parseStatus)) &&
            pollRef.current
          ) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch {
          // ignore transient polling errors
        }
      }, 4000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [docs, loadTimeline]);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      // Direct-to-S3, same path as the chat's documents panel.
      await uploadDocuments(id, toUploadCandidates([file]));
      await loadTimeline();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  // THE list. Rows, select-all and bulk actions are all derived from this one array — see the
  // comment on filterDocuments: a select-all computed over anything wider than what she can see is
  // how one click archives documents the filter is hiding.
  const visibleDocs = useMemo(
    () =>
      filterDocuments(docs, {
        query,
        shelf,
        documentIds: graphFocus?.documentIds
      }),
    [docs, query, shelf, graphFocus]
  );
  const visibleIds = useMemo(
    () => visibleDocs.map((doc) => doc.id),
    [visibleDocs]
  );
  const summary = useMemo(
    () => selectionSummary(selection.selectedIds, visibleIds),
    [selection.selectedIds, visibleIds]
  );
  const grouping = useMemo(() => groupByYear(visibleDocs), [visibleDocs]);

  // Rarity is measured over the WHOLE corpus, both shelves: how distinctive 'donations' is must not
  // change because the archive shelf was toggled. Hoisted out of the row loop, per the module's
  // note on rankTagsByDistinctiveness.
  const tagFrequencies = useMemo(() => countTagFrequencies(docs), [docs]);
  const shelfCounts = useMemo(() => countByShelf(docs), [docs]);

  // The graph is built over the current shelf and deliberately NOT over the search results or the
  // node click: it is the map she navigates with, so it must not redraw itself under the click that
  // is using it.
  const shelfDocs = useMemo(
    () => filterDocuments(docs, { shelf }),
    [docs, shelf]
  );
  const graph = useMemo(() => buildRelationGraph(shelfDocs), [shelfDocs]);

  // A filter is anything narrower than "the whole live corpus" — a search, a graph click, or the
  // archive shelf. When one is on, the select-all names how many rows it covers instead of saying
  // "all": the whole point is that select-all can never be read as reaching documents the filter is
  // hiding, so the scope is written into the label itself.
  const filterActive =
    query.trim() !== "" || graphFocus !== null || shelf !== "case";
  const selectAllLabel = filterActive
    ? dv.selectAllFiltered.replace("{count}", String(visibleIds.length))
    : dv.selectAll;

  const patchLifecycle = useCallback(
    (ids: string[], lifecycleState: LexDocument["lifecycleState"]) => {
      const moved = new Set(ids);
      setDocs((prev) =>
        prev.map((doc) =>
          moved.has(doc.id) ? { ...doc, lifecycleState } : doc
        )
      );
    },
    []
  );

  const handleRowClick = (docId: string, e: React.MouseEvent) => {
    setSelection((prev) =>
      nextSelection(prev, visibleIds, docId, {
        shift: e.shiftKey,
        meta: e.metaKey || e.ctrlKey
      })
    );
  };

  // Replaces rather than unions: "tout sélectionner" then has to mean exactly the rows on screen,
  // with nothing carried in from a previous filter that the user can no longer see.
  const handleSelectAll = () =>
    setSelection({ selectedIds: visibleIds, anchorId: null });

  const handleArchive = async () => {
    // Scoped to the filter, not to `selection.selectedIds`: hidden rows are reported in the bar and
    // left alone. This is the safety property the whole selection model exists for.
    const ids = summary.visibleSelectedIds;
    if (ids.length === 0) return;
    setIsMutating(true);
    try {
      // `documentIds` is what actually moved, which can be fewer than `ids`: the server only archives
      // 'active' rows, so a superseded duplicate in the selection stays put. Patching and counting
      // from the response rather than from the request keeps the row and the number honest, and keeps
      // the Undo unable to restore anything this archive did not archive.
      const { documentIds } = await api.lex.documents.bulkArchive(ids);
      patchLifecycle(documentIds, "archived");
      setSelection(EMPTY_SELECTION);
      setLastArchived(documentIds);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsMutating(false);
    }
  };

  const restore = async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsMutating(true);
    try {
      const { documentIds } = await api.lex.documents.bulkRestore(ids);
      patchLifecycle(documentIds, "active");
      setSelection(EMPTY_SELECTION);
      setLastArchived(null);
      toast({
        title: dv.restoredToast.replace("{count}", String(documentIds.length))
      });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    try {
      await api.lex.documents.delete(docId);
      setDocs((prev) => prev.filter((doc) => doc.id !== docId));
      setSelection((prev) => deselect(prev, [docId]));
      setLastArchived((prev) =>
        prev ? prev.filter((id) => id !== docId) : prev
      );
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  // Switching shelf clears the selection and the graph focus: the archived pile is a different
  // subject, and carrying a selection across would leave rows ticked that are no longer on screen.
  const selectShelf = (next: DocumentShelf) => {
    if (next === shelf) return;
    setShelf(next);
    setSelection(EMPTY_SELECTION);
    setGraphFocus(null);
    setLastArchived(null);
  };

  const focusNode = (node: RelationNode) => {
    setGraphFocus((prev) =>
      prev?.selection.kind === "node" && prev.selection.id === node.id
        ? null
        : {
            selection: { kind: "node", id: node.id },
            documentIds: node.documentIds,
            label: dv.filteredByPerson.replace("{name}", node.name)
          }
    );
  };

  const focusEdge = (edge: RelationEdge) => {
    setGraphFocus((prev) =>
      prev?.selection.kind === "edge" &&
      prev.selection.source === edge.source &&
      prev.selection.target === edge.target
        ? null
        : {
            selection: {
              kind: "edge",
              source: edge.source,
              target: edge.target
            },
            documentIds: edge.documentIds,
            // The label is the co-mention sentence itself, not "X → Y": the chip is one more place
            // the relation must read as "named in the same documents" and nothing stronger.
            label: dv.coMentionPair
              .replace("{a}", edge.sourceName)
              .replace("{b}", edge.targetName)
              .replace("{count}", String(edge.weight))
          }
    );
  };

  const rowLabels = {
    select: dv.selectRow,
    restore: dv.restore,
    archivedBadge: dv.archivedBadge,
    delete: t.lex.delete,
    view: t.lex.viewDocument,
    searchHint: t.lex.searchDocuments,
    noDate: t.lex.noDate
  };

  // Branches on the SHELF's own population, not on `docs.length`: docs holds every shelf, so an
  // empty case file whose documents are all archived would otherwise be reported as "no document
  // matches this search" with an empty search box.
  const emptyMessage =
    query.trim() || graphFocus
      ? t.lex.noSearchResults
      : shelf === "archived"
        ? dv.noArchived
        : shelf === "pending"
          ? dv.noPending
          : shelfCounts.case === 0 && docs.length > 0
            ? dv.caseEmptyButOthers
            : t.lex.noDocuments;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back to the chat, which is the workspace's home. */}
      <button
        onClick={() => navigate(`/lex/workspaces/${id}`)}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.lex.back}
      </button>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-serif font-bold truncate">
            {workspace?.name ?? t.lex.title}
          </h1>
          {workspace?.description ? (
            <p className="text-sm text-muted-foreground">
              {workspace.description}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(`/lex/workspaces/${id}`)}
          className="shrink-0"
        >
          <MessageSquare className="h-4 w-4 mr-2" />
          {t.lex.chat}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate(`/lex/workspaces/${id}/artifacts`)}
          className="shrink-0"
        >
          <FileSignature className="h-4 w-4 mr-2" />
          {t.lex.openArtifacts}
        </Button>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="gradient-terracotta text-white shrink-0"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          {isUploading ? t.lex.uploading : t.lex.uploadDocument}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Toolbar. Stays visible while a selection is live, deliberately: the select-all below is
          scoped to this filter, so the filter that scopes it has to remain on screen. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.lex.searchDocuments}
            className="h-9 pl-8 text-sm"
          />
        </div>

        <div
          role="group"
          aria-label={dv.density}
          className="inline-flex rounded-md border p-0.5"
        >
          <button
            onClick={() => setDensity("dense")}
            title={dv.densityDense}
            className={
              density === "dense"
                ? "px-2 py-1 rounded bg-muted text-foreground inline-flex items-center gap-1 text-xs"
                : "px-2 py-1 rounded text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            }
          >
            <Rows3 className="h-3.5 w-3.5" />
            {dv.densityDense}
          </button>
          <button
            onClick={() => setDensity("comfortable")}
            title={dv.densityComfortable}
            className={
              density === "comfortable"
                ? "px-2 py-1 rounded bg-muted text-foreground inline-flex items-center gap-1 text-xs"
                : "px-2 py-1 rounded text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            }
          >
            <FileText className="h-3.5 w-3.5" />
            {dv.densityComfortable}
          </button>
        </div>

        <Button
          variant={showRelations ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowRelations((prev) => !prev)}
          className="h-9"
        >
          <Network className="h-4 w-4 mr-2" />
          {dv.relations}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/lex/workspaces/${id}/story`)}
          className="h-9"
        >
          <CalendarClock className="h-4 w-4 mr-2" />
          {t.lex.story.tab}
        </Button>

        <div className="flex items-center rounded-lg border p-0.5" role="group">
          {SHELVES.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => selectShelf(key)}
              aria-pressed={shelf === key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                shelf === key
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label(dv, t)}
              <span className="tabular-nums opacity-60">
                {shelfCounts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {shelf === "pending" ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-2.5">
          {dv.pendingHint}
        </p>
      ) : null}

      {showRelations ? (
        <RelationsGraph
          graph={graph}
          selection={graphFocus?.selection ?? null}
          onSelectNode={focusNode}
          onSelectEdge={focusEdge}
          onClear={() => setGraphFocus(null)}
        />
      ) : null}

      <div>
        {/* The header area becomes the selection bar once anything is ticked. */}
        {summary.count > 0 ? (
          <div className="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* Master checkbox. Indeterminate is a DOM-only property, hence the ref: it is what
                distinguishes "some of what you can see" from "all of it", and that distinction is
                the one the user needs before pressing a bulk action. */}
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = summary.someVisibleSelected;
              }}
              checked={summary.allVisibleSelected}
              onChange={() =>
                summary.allVisibleSelected
                  ? setSelection(EMPTY_SELECTION)
                  : handleSelectAll()
              }
              aria-label={selectAllLabel}
            />
            <span className="text-sm font-medium">
              {summary.count} {t.lex.selected}
            </span>
            <button
              onClick={handleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {selectAllLabel}
            </button>
            <button
              onClick={() => setSelection(EMPTY_SELECTION)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t.lex.clearSelection}
            </button>
            <div className="flex-1" />
            {shelf === "archived" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isMutating || summary.visibleSelectedIds.length === 0}
                onClick={() => restore(summary.visibleSelectedIds)}
                className="h-8"
              >
                {isMutating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                ) : (
                  <ArchiveRestore className="h-3.5 w-3.5 mr-2" />
                )}
                {dv.restoreCount.replace(
                  "{count}",
                  String(summary.visibleSelectedIds.length)
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isMutating || summary.visibleSelectedIds.length === 0}
                onClick={handleArchive}
                className="h-8"
              >
                {isMutating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                ) : (
                  <Archive className="h-3.5 w-3.5 mr-2" />
                )}
                {dv.archiveCount.replace(
                  "{count}",
                  String(summary.visibleSelectedIds.length)
                )}
              </Button>
            )}
            {/* Said out loud, because the action button's count is smaller than the selection's. */}
            {summary.hiddenSelectedCount > 0 ? (
              <p className="w-full text-[11px] text-muted-foreground">
                {dv.hiddenByFilter.replace(
                  "{count}",
                  String(summary.hiddenSelectedCount)
                )}
                {" · "}
                {dv.selectionScopedToFilter.replace(
                  "{count}",
                  String(summary.visibleSelectedIds.length)
                )}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {SHELF_HEADINGS[shelf](dv, t)}
            </h2>
            <div className="flex items-center gap-3">
              {visibleIds.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {dv.documentsCount.replace(
                    "{count}",
                    String(visibleIds.length)
                  )}
                </span>
              ) : null}
              {/* Unchecked by construction: this branch only renders while nothing is selected. */}
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={visibleIds.length === 0}
                  onChange={handleSelectAll}
                />
                {selectAllLabel}
              </label>
            </div>
          </div>
        )}

        {/* The graph's current filter, and how to drop it. */}
        {graphFocus ? (
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              {graphFocus.label}
            </span>
            <button
              onClick={() => setGraphFocus(null)}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              {dv.clearGraphFilter}
            </button>
          </div>
        ) : null}

        {/* The Undo. An inline bar rather than a toast action: the app's toast renders only a title
            and auto-dismisses in 4 s, which is not an undo window, and faking one would mean
            changing a component every other toast in the app shares. */}
        {lastArchived && lastArchived.length > 0 ? (
          <div className="mb-3 rounded-xl border bg-card px-3 py-2 flex flex-wrap items-center gap-3">
            <Archive className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm">
              {dv.archivedToast.replace("{count}", String(lastArchived.length))}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={isMutating}
              onClick={() => restore(lastArchived)}
              className="h-8"
            >
              <Undo2 className="h-3.5 w-3.5 mr-2" />
              {dv.undoArchive}
            </Button>
            <div className="flex-1" />
            <button
              onClick={() => setLastArchived(null)}
              aria-label={t.lex.cancel}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="w-full text-[11px] text-muted-foreground">
              {dv.archiveHint}
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="relative border-l border-border ml-2">
            {/* Year rails. `grouping.groups` is the only list, and the undated group is its last
                element, so mapping over it cannot drop an undated document — a piece with no
                extracted date has to stay reachable.
                `sticky` binds to the nearest scrollport, which is AdminLayout's <main> (it carries
                overflow-auto). That element currently stretches to its content rather than to the
                viewport, so nothing scrolls inside it and the rail reads as a plain separator; it
                starts pinning the moment the layout gives <main> a bounded height. */}
            {grouping.groups.map((group) => (
              <section key={group.kind === "year" ? group.year : "undated"}>
                <div className="sticky top-0 z-10 -ml-2 bg-background/95 backdrop-blur px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  {group.kind === "year" ? group.year : t.lex.noDate}
                  {" · "}
                  {group.documents.length}
                </div>
                <ol
                  className={
                    density === "dense" ? "space-y-1 pb-2" : "space-y-3 pb-3"
                  }
                >
                  {group.documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      tags={rankTagsWithFrequencies(
                        tagFrequencies,
                        doc.tags,
                        density === "dense"
                          ? DENSE_TAG_LIMIT
                          : COMFORTABLE_TAG_LIMIT
                      )}
                      density={density}
                      selected={selection.selectedIds.includes(doc.id)}
                      showCheckbox={summary.count > 0}
                      archived={isArchived(doc)}
                      labels={rowLabels}
                      onRowClick={(e) => handleRowClick(doc.id, e)}
                      onTagClick={setQuery}
                      onOpen={() => setViewerDoc(doc)}
                      onRestore={() => restore([doc.id])}
                      onDelete={() => handleDelete(doc.id)}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>

      {viewerDoc ? (
        <DocumentViewerDialog
          document={viewerDoc}
          onClose={() => setViewerDoc(null)}
        />
      ) : null}
    </div>
  );
}
