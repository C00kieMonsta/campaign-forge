import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent
} from "react";
import type { CreateContactRequest } from "@packages/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input
} from "@packages/ui";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { readAbbu } from "@/lib/abbu";
import { api } from "@/lib/api";
import {
  intakeFromDrop,
  intakeFromFiles,
  snapshotDrop,
  type Intake
} from "@/lib/archiveIntake";
import { downloadTemplate } from "@/lib/contactCsv";
import { errorMessage } from "@/lib/errorMessage";
import {
  autofillNames,
  buildBatch,
  csvToRawCandidates,
  isComplete,
  sortCandidates,
  toCreateRequest,
  type ImportCandidate,
  type RawCandidate
} from "@/lib/importCandidates";
import {
  clearImportSession,
  loadImportSession,
  restoreRows,
  saveImportSession,
  type ImportSession
} from "@/lib/importSession";
import { AUTO_COLORS } from "./constants";
import type { ContactGroup } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ContactGroup[];
  /** Lowercase emails already in the list, primary and secondary alike. */
  existingEmails: Set<string>;
  onImported: () => Promise<void> | void;
  onOpenAssistant: () => void;
}

type Step = "pick" | "reading" | "review" | "importing" | "importError";
type NameKey = "firstName" | "lastName";

/** One review row: the candidate, its tick and the server's reason when it refused the row. */
interface Row {
  c: ImportCandidate;
  selected: boolean;
  serverError: string | null;
}

interface Summary {
  source: "abbu" | "csv";
  alreadyPresent: number;
  withoutEmail: number;
  duplicatesInFile: number;
  newGroupNames: string[];
}

interface Progress {
  done: number;
  total: number;
}

/** Why the import stopped and where it stands, shown until Réessayer or Fermer. */
interface ImportStop {
  created: number;
  remaining: number;
  message: string;
}

/** What the batches already answered gave back, kept across a retry. */
interface Tallies {
  created: number;
  createdLower: Set<string>;
  existing: string[];
  errors: { email: string; reason: string }[];
}

const PAGE_SIZE = 100;
/** The server accepts at most 100 contacts per create call. */
const BATCH_SIZE = 100;
/** A change is written this long after the last one, and never later than SAVE_MAX_WAIT after the first unsaved one. */
const SAVE_DEBOUNCE = 400;
const SAVE_MAX_WAIT = 2000;

const PILL =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";
const TILE =
  "flex min-h-[7rem] w-full flex-col items-center justify-center gap-2 rounded-xl border bg-background px-3 py-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground";

type SessionArgs = Omit<ImportSession, "version" | "savedAt">;

const emptyTallies = (): Tallies => ({
  created: 0,
  createdLower: new Set(),
  existing: [],
  errors: []
});

/** The saved form of a review list. */
const toSessionArgs = (
  summary: Summary,
  rows: Row[],
  page: number,
  focusIndex: number
): SessionArgs => ({
  source: summary.source,
  summary: {
    alreadyPresent: summary.alreadyPresent,
    withoutEmail: summary.withoutEmail,
    duplicatesInFile: summary.duplicatesInFile,
    newGroupNames: summary.newGroupNames
  },
  rows,
  page,
  focusIndex
});

/** Rows still to send: written and existing ones gone, refused ones ticked with their reason. */
const afterTallies = (list: Row[], tally: Tallies): Row[] => {
  const gone = new Set<string>(tally.createdLower);
  for (const email of tally.existing) gone.add(email.toLowerCase());
  const failed = new Map(
    tally.errors.map((e) => [e.email.toLowerCase(), e.reason])
  );
  return list
    .filter((r) => !gone.has(r.c.email.toLowerCase()))
    .map((r) => {
      const reason = failed.get(r.c.email.toLowerCase());
      return reason ? { ...r, selected: true, serverError: reason } : r;
    });
};

function Tile({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={TILE}>
      <Icon className="h-6 w-6" />
      {label}
    </button>
  );
}

interface RowProps {
  row: Row;
  /** The row whose checkbox and inputs Tab reaches; the arrow keys move it. */
  focused: boolean;
  /** Id of the keyboard hint, read out as the checkbox description. */
  hintId: string;
  onSelect: (id: string, selected: boolean) => void;
  onName: (id: string, key: NameKey, value: string) => void;
  onFocusRow: (id: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

/** Memoized at module level so a re-render of the dialog does not remount the inputs. */
const ImportRow = memo(function ImportRow({
  row,
  focused,
  hintId,
  onSelect,
  onName,
  onFocusRow,
  registerRef
}: RowProps) {
  const { t } = useLanguage();
  const ti = t.contactImport;
  const tf = t.contactForm;
  const { c } = row;
  const f = c.fields;
  const complete = isComplete(c);
  const name = `${f.firstName ?? ""} ${f.lastName ?? ""}`.trim();
  const organization = (f.organization ?? "").trim();

  return (
    <div
      ref={(el) => registerRef(c.id, el)}
      data-row-id={c.id}
      onFocus={() => onFocusRow(c.id)}
      className={`flex items-start gap-3 rounded-xl border p-3 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${row.selected ? "" : "bg-muted/30"}`}
    >
      <Checkbox
        className="mt-0.5 size-5"
        tabIndex={focused ? 0 : -1}
        checked={row.selected}
        onCheckedChange={(v) => onSelect(c.id, v === true)}
        aria-label={c.email}
        aria-describedby={hintId}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {c.needsName ? (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:max-w-md">
              <Input
                tabIndex={focused ? 0 : -1}
                value={f.firstName ?? ""}
                onChange={(e) => onName(c.id, "firstName", e.target.value)}
                placeholder={tf.firstName}
                aria-label={tf.firstName}
                className="h-10"
              />
              <Input
                tabIndex={focused ? 0 : -1}
                value={f.lastName ?? ""}
                onChange={(e) => onName(c.id, "lastName", e.target.value)}
                placeholder={tf.lastName}
                aria-label={tf.lastName}
                className="h-10"
              />
            </div>
          ) : (
            <span className="truncate font-medium">{name}</span>
          )}
          {complete ? null : (
            <span
              className={`${PILL} border-amber-200 bg-amber-100 text-amber-700`}
            >
              {ti.noName}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span className="truncate">{c.email}</span>
          {organization ? (
            <span className="truncate">{organization}</span>
          ) : null}
        </div>
        {row.serverError ? (
          <p className="text-xs text-destructive">{row.serverError}</p>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Imports contacts from an Apple Contacts archive (.abbu dropped from the Finder or zipped) or
 * from the CSV template. Everything already in the list is counted and skipped; the rest is
 * reviewed, names can be completed, then the rows are written in batches through the conditional
 * create endpoint so an existing contact is never replaced or re-subscribed.
 */
export function ImportDialog({
  open,
  onOpenChange,
  groups,
  existingEmails,
  onImported,
  onOpenAssistant
}: Props) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const ti = t.contactImport;

  const [step, setStep] = useState<Step>("pick");
  // Whether the last save of the review list succeeded; null before any save.
  const [persisted, setPersisted] = useState<boolean | null>(null);
  // Set when the list on screen came back from storage.
  const [resumed, setResumed] = useState<{
    savedAt: string;
    dropped: number;
  } | null>(null);
  // A saved list the pick step can take up again or abandon.
  const [pending, setPending] = useState<{ count: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [page, setPage] = useState(1);
  const [stop, setStop] = useState<ImportStop | null>(null);
  // Index into rows of the row the keyboard is on; only its checkbox and inputs are Tab stops.
  const [focusIndex, setFocusIndex] = useState(0);
  const hintId = useId();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // A row to focus once its page is on screen (arrow keys across a page break, first review paint).
  const pendingFocusRef = useRef<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Bumped on every close so a read or a batch that lands afterwards is ignored.
  const runRef = useRef(0);
  // Groups created in this session, so a retry does not create them twice.
  const createdGroupsRef = useRef(new Map<string, string>());
  const batchesRef = useRef<CreateContactRequest[][]>([]);
  const failedBatchRef = useRef(0);
  const talliesRef = useRef<Tallies>(emptyTallies());
  // The list behind the Reprendre row, kept in memory so Retour then Reprendre works when storage is full.
  const pendingRef = useRef<ImportSession | null>(null);
  // The payload a flush writes; null outside the review step.
  const saveArgsRef = useRef<SessionArgs | null>(null);
  // When the first unsaved change happened; the debounce never waits past SAVE_MAX_WAIT from it.
  const dirtySinceRef = useRef<number | null>(null);

  /** Writes the review list now; a no-op outside the review step. */
  const flushSave = useCallback(() => {
    const args = saveArgsRef.current;
    if (!args) return;
    dirtySinceRef.current = null;
    setPersisted(saveImportSession(args));
  }, []);

  const reset = () => {
    setFocusIndex(0);
    pendingFocusRef.current = null;
    pendingRef.current = null;
    dirtySinceRef.current = null;
    setPersisted(null);
    setResumed(null);
    setPending(null);
    setStep("pick");
    setDragOver(false);
    setPickError(null);
    setProgress(null);
    setRows([]);
    setSummary(null);
    setPage(1);
    setStop(null);
    batchesRef.current = [];
    failedBatchRef.current = 0;
    talliesRef.current = emptyTallies();
  };

  useEffect(() => {
    if (open) return;
    // Annuler, Escape and the overlay keep the list; what the debounce still holds is written first.
    flushSave();
    runRef.current += 1;
    createdGroupsRef.current = new Map();
    reset();
  }, [open]);

  // Leaving the page with the dialog open (browser back) writes what the debounce still holds.
  useEffect(() => () => flushSave(), [flushSave]);

  const summaryOf = (session: ImportSession, dropped: number): Summary => {
    const known = new Set(groups.map((g) => g.name.trim().toLowerCase()));
    return {
      source: session.source,
      alreadyPresent: session.summary.alreadyPresent + dropped,
      withoutEmail: session.summary.withoutEmail,
      duplicatesInFile: session.summary.duplicatesInFile,
      newGroupNames: session.summary.newGroupNames.filter(
        (n) => !known.has(n.trim().toLowerCase())
      )
    };
  };

  /** Puts a saved list back on screen; false when nothing of it is left to review. */
  const applySession = (session: ImportSession): boolean => {
    const { rows: kept, dropped } = restoreRows(session.rows, existingEmails);
    if (kept.length === 0) {
      clearImportSession();
      toast({ title: `${session.rows.length} ${ti.droppedSince}` });
      return false;
    }
    const focus = Math.max(0, Math.min(kept.length - 1, session.focusIndex));
    const pages = Math.max(1, Math.ceil(kept.length / PAGE_SIZE));
    const page = Math.max(1, Math.min(pages, session.page));
    // Back on the page that was open; the keyboard lands on its row there, else on the page's first.
    const onPage = Math.floor(focus / PAGE_SIZE) + 1 === page;
    setRows(kept);
    setSummary(summaryOf(session, dropped));
    setFocusIndex(focus);
    setPage(page);
    pendingFocusRef.current =
      (onPage ? kept[focus] : kept[(page - 1) * PAGE_SIZE])?.c.id ?? null;
    setResumed({ savedAt: session.savedAt, dropped });
    setPending(null);
    setPickError(null);
    setStep("review");
    return true;
  };

  // A list saved before a refresh or a closed tab comes straight back when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const session = loadImportSession();
    if (session) applySession(session);
  }, [open]);

  /** Takes the list behind the Reprendre row up again; the in-memory copy wins over storage. */
  const resumePending = () => {
    const session = pendingRef.current ?? loadImportSession();
    pendingRef.current = null;
    if (!session || !applySession(session)) setPending(null);
  };

  const abandonPending = () => {
    clearImportSession();
    pendingRef.current = null;
    setPersisted(null);
    setPending(null);
  };

  const savedAtLabel = (iso: string) =>
    new Date(iso).toLocaleString(language === "nl" ? "nl-BE" : "fr-BE", {
      dateStyle: "short",
      timeStyle: "short"
    });

  const fail = (message: string) => {
    setPickError(message);
    setStep("pick");
  };

  /** Reads whatever was dropped or picked and builds the review list. */
  const intake = async (load: () => Promise<Intake>) => {
    // A saved list must be taken up or abandoned before another file replaces it.
    if (pending) return;
    const run = runRef.current;
    setPickError(null);
    setProgress(null);
    setStep("reading");
    try {
      const result = await load();
      if (run !== runRef.current) return;
      if (result.kind === "package") {
        fail(ti.packageHint);
        return;
      }
      if (result.kind === "unknown") {
        fail(ti.unknownFormat);
        return;
      }
      let raw: RawCandidate[];
      if (result.kind === "csv") {
        raw = csvToRawCandidates(await result.file.text());
        if (run !== runRef.current) return;
        if (raw.length === 0) {
          fail(ti.emptyCsv);
          return;
        }
      } else {
        const read = await readAbbu(result.entries, (done, total) => {
          if (run === runRef.current) setProgress({ done, total });
        });
        if (run !== runRef.current) return;
        raw = read.raw;
        if (raw.length === 0) {
          fail(ti.noRecords);
          return;
        }
      }
      const groupNamesLower = new Set(
        groups.map((g) => g.name.trim().toLowerCase())
      );
      const batch = buildBatch(raw, existingEmails, groupNamesLower);
      const candidates = sortCandidates(batch.candidates);
      const nextRows = candidates.map((c) => ({
        c,
        selected: true,
        serverError: null
      }));
      const nextSummary: Summary = {
        source: result.kind,
        alreadyPresent: batch.alreadyPresent,
        withoutEmail: batch.withoutEmail,
        duplicatesInFile: batch.duplicatesInFile,
        newGroupNames: batch.newGroupNames
      };
      setRows(nextRows);
      setSummary(nextSummary);
      setPage(1);
      setFocusIndex(0);
      pendingFocusRef.current = candidates[0]?.id ?? null;
      setResumed(null);
      setPending(null);
      pendingRef.current = null;
      dirtySinceRef.current = null;
      // A new list replaces whatever was saved; a failed save must not leave the old one behind.
      clearImportSession();
      // Saved at once: a refresh a moment after the read must not cost the parse.
      setPersisted(
        nextRows.length > 0
          ? saveImportSession(toSessionArgs(nextSummary, nextRows, 1, 0))
          : null
      );
      setStep("review");
    } catch (err) {
      if (run !== runRef.current) return;
      fail(errorMessage(err));
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    // Without preventDefault the browser never fires drop.
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  /** A drop beside the zone must not make the browser open the file. */
  const swallowDrag = (e: DragEvent<HTMLDivElement>) => e.preventDefault();

  /** A stalled batch is reported in the user's words, not as a DOMException name. */
  const stopMessage = (err: unknown) => {
    const name = (err as { name?: unknown } | null)?.name;
    return name === "TimeoutError" || name === "AbortError"
      ? ti.timeout
      : errorMessage(err);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // The DataTransfer is emptied once the handler returns, so grab it before anything else.
    const snap = snapshotDrop(e.dataTransfer);
    setDragOver(false);
    void intake(() => intakeFromDrop(snap));
  };

  const onFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    void intake(() => intakeFromFiles(files));
  };

  const openAssistant = () => {
    onOpenChange(false);
    onOpenAssistant();
  };

  /** Back to the pick step; the list stays saved and can be taken up again from there. */
  const goBack = () => {
    dirtySinceRef.current = null;
    if (summary && rows.length > 0) {
      const args = toSessionArgs(summary, rows, currentPage, focusIndex);
      setPersisted(saveImportSession(args));
      pendingRef.current = {
        version: 1,
        savedAt: new Date().toISOString(),
        ...args
      };
      setPending({ count: rows.length });
    } else {
      clearImportSession();
      pendingRef.current = null;
      setPersisted(null);
      setPending(null);
    }
    setResumed(null);
    setFocusIndex(0);
    pendingFocusRef.current = null;
    setRows([]);
    setSummary(null);
    setPage(1);
    setPickError(null);
    setStep("pick");
  };

  const setSelected = useCallback((id: string, selected: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.c.id === id ? { ...r, selected } : r))
    );
  }, []);

  const setName = useCallback((id: string, key: NameKey, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.c.id === id
          ? { ...r, c: { ...r.c, fields: { ...r.c.fields, [key]: value } } }
          : r
      )
    );
  }, []);

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // The current rows, readable from the stable callbacks the memoized rows receive.
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;

  const rowIndex = (id: string) => rows.findIndex((r) => r.c.id === id);

  const onFocusRow = useCallback((id: string) => {
    const index = rowsRef.current.findIndex((r) => r.c.id === id);
    if (index >= 0) setFocusIndex(index);
  }, []);

  // The checkbox is the focus target, so a screen reader announces the row by its email and state.
  const checkboxOf = (rowEl: HTMLElement) =>
    rowEl.querySelector<HTMLElement>('[role="checkbox"]');

  const focusRowEl = (el: HTMLElement) => {
    checkboxOf(el)?.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };

  /** Moves the keyboard to a row, turning the page first when it is not on screen. */
  const focusRow = (index: number) => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    const id = rows[bounded]?.c.id;
    if (!id) return;
    setFocusIndex(bounded);
    const el = rowRefs.current.get(id);
    if (el) {
      focusRowEl(el);
      return;
    }
    pendingFocusRef.current = id;
    setPage(Math.floor(bounded / PAGE_SIZE) + 1);
  };

  // Focus the row a page turn or the first review paint asked for, once it exists.
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    const el = rowRefs.current.get(id);
    if (!el) return;
    pendingFocusRef.current = null;
    focusRowEl(el);
  });

  /** Arrows move between rows, Enter ticks or unticks; nothing here starts the import. */
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // IME commits (keyCode 229 on Safari) and modifier shortcuts stay with the browser.
    if (
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey
    ) {
      return;
    }
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>("[data-row-id]");
    const id = rowEl?.dataset.rowId;
    if (!rowEl || !id) return;
    const index = rowIndex(id);
    if (index < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(index + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // A held key must not flip the tick on every repeat.
      if (e.repeat) return;
      // Enter in a name field moves to the checkbox; a second Enter then ticks the row.
      if (target.tagName === "INPUT") checkboxOf(rowEl)?.focus();
      else setSelected(id, !rows[index].selected);
    }
  };

  const selectAll = (selected: boolean) =>
    setRows((prev) =>
      prev.map((r) => (r.selected === selected ? r : { ...r, selected }))
    );

  const { selectedCount, incompleteSelected } = useMemo(() => {
    let selected = 0;
    let incomplete = 0;
    for (const r of rows) {
      if (!r.selected) continue;
      selected += 1;
      if (!isComplete(r.c)) incomplete += 1;
    }
    return { selectedCount: selected, incompleteSelected: incomplete };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [rows, currentPage]
  );

  saveArgsRef.current =
    step === "review" && summary && rows.length > 0
      ? toSessionArgs(summary, rows, currentPage, focusIndex)
      : null;

  // Every tick, typed name and page turn is saved shortly after it happens, until the import is done.
  useEffect(() => {
    if (step !== "review" || !summary || rows.length === 0) return;
    const now = Date.now();
    if (dirtySinceRef.current === null) dirtySinceRef.current = now;
    const delay = Math.min(
      SAVE_DEBOUNCE,
      Math.max(0, dirtySinceRef.current + SAVE_MAX_WAIT - now)
    );
    const timer = setTimeout(flushSave, delay);
    return () => clearTimeout(timer);
  }, [rows, currentPage, focusIndex, step, summary, flushSave]);

  // A refresh, a closed tab or a backgrounded page writes what the debounce still holds.
  useEffect(() => {
    if (step !== "review") return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [step, flushSave]);

  // The row Tab lands on: the keyboard's row, or the first of the page when that row is elsewhere.
  const keyboardId =
    rows[Math.min(focusIndex, Math.max(0, rows.length - 1))]?.c.id ?? null;
  const focusedId = pageRows.some((r) => r.c.id === keyboardId)
    ? keyboardId
    : (pageRows[0]?.c.id ?? null);

  /** Fills the blank names of every ticked row; the inputs stay editable afterwards. */
  const autofill = () => {
    // The button unmounts with its block once every name is filled, so move the keyboard to its row first.
    const el = focusedId ? rowRefs.current.get(focusedId) : undefined;
    if (el) checkboxOf(el)?.focus({ preventScroll: true });
    const salutation = ti.salutation;
    setRows((prev) =>
      prev.map((r) =>
        r.selected && !isComplete(r.c)
          ? { ...r, c: autofillNames(r.c, salutation) }
          : r
      )
    );
  };

  const goToPage = (next: number) => {
    setPage(next);
    listRef.current?.scrollTo({ top: 0 });
  };

  /** Group ids by lowercase name: the page's groups plus the ones made in this session. */
  const groupIndex = () => {
    const idByName = new Map<string, string>();
    for (const g of groups) idByName.set(g.name.trim().toLowerCase(), g.id);
    for (const [name, id] of createdGroupsRef.current) idByName.set(name, id);
    return idByName;
  };

  const resultToast = (tally: Tallies) => {
    const parts = [`${tally.created} ${ti.imported}`];
    if (tally.existing.length > 0) {
      parts.push(`${tally.existing.length} ${ti.alreadyPresent}`);
    }
    if (tally.errors.length > 0) {
      parts.push(`${tally.errors.length} ${ti.inError}`);
    }
    toast({ title: parts.join(", ") });
  };

  /** Every batch answered: close when all went in, else keep the refused rows for another try. */
  const complete = async () => {
    const tally = talliesRef.current;
    resultToast(tally);
    if (tally.errors.length === 0) {
      // The creation is confirmed, so there is nothing left to come back to.
      clearImportSession();
      onOpenChange(false);
      await onImported();
      return;
    }
    setRows((prev) => afterTallies(prev, tally));
    setStep("review");
    await onImported();
  };

  /** A stopped import is saved at once, so Fermer or a closed tab keeps the refused rows' reasons. */
  const stopImport = (stopped: ImportStop) => {
    if (summary) {
      const left = afterTallies(rowsRef.current, talliesRef.current);
      if (left.length > 0) {
        saveImportSession(
          toSessionArgs(summary, left, currentPage, focusIndex)
        );
      } else {
        clearImportSession();
      }
    }
    setStop(stopped);
    setStep("importError");
  };

  /** Sends the batches from the given index; a thrown batch stops here and can be resumed. */
  const sendFrom = async (from: number, run: number) => {
    const batches = batchesRef.current;
    const total = batches.reduce((n, b) => n + b.length, 0);
    let done = 0;
    for (let i = 0; i < from; i++) done += batches[i].length;
    setProgress({ done, total });
    for (let i = from; i < batches.length; i++) {
      try {
        const res = await api.contacts.assistant.create(batches[i], "import");
        if (run !== runRef.current) return;
        const tally = talliesRef.current;
        tally.created += res.created.length;
        for (const made of res.created) tally.createdLower.add(made.emailLower);
        tally.existing.push(...res.existing);
        tally.errors.push(...res.errors);
        done += batches[i].length;
        setProgress({ done, total });
      } catch (err) {
        if (run !== runRef.current) return;
        failedBatchRef.current = i;
        stopImport({
          created: talliesRef.current.created,
          remaining: total - done,
          message: stopMessage(err)
        });
        return;
      }
    }
    await complete();
  };

  /** Creates the missing groups, builds the batches, then sends them from the first one. */
  const startImport = async () => {
    // Written now, so a batch that fails and Fermer bring the list back as it was sent.
    flushSave();
    const run = runRef.current;
    const selected = rows.filter((r) => r.selected).map((r) => r.c);
    talliesRef.current = emptyTallies();
    batchesRef.current = [];
    failedBatchRef.current = 0;
    setStop(null);
    setProgress({ done: 0, total: selected.length });
    setStep("importing");
    try {
      const idByName = groupIndex();
      for (const name of summary?.newGroupNames ?? []) {
        const lower = name.toLowerCase();
        if (idByName.has(lower)) continue;
        const index = groups.length + createdGroupsRef.current.size;
        const group = await api.groups.create({
          name,
          color: AUTO_COLORS[index % AUTO_COLORS.length]
        });
        idByName.set(lower, group.id);
        createdGroupsRef.current.set(lower, group.id);
      }
      if (run !== runRef.current) return;
      const requests = selected.map((c) =>
        toCreateRequest(
          c,
          c.groupNames
            .map((n) => idByName.get(n.trim().toLowerCase()))
            .filter((id): id is string => !!id)
        )
      );
      const batches: CreateContactRequest[][] = [];
      for (let i = 0; i < requests.length; i += BATCH_SIZE) {
        batches.push(requests.slice(i, i + BATCH_SIZE));
      }
      batchesRef.current = batches;
    } catch (err) {
      if (run !== runRef.current) return;
      stopImport({
        created: 0,
        remaining: selected.length,
        message: errorMessage(err)
      });
      return;
    }
    await sendFrom(0, run);
  };

  /** Resumes at the batch that failed; rows written meanwhile come back as existing. */
  const retry = () => {
    if (batchesRef.current.length === 0) {
      void startImport();
      return;
    }
    setStop(null);
    setStep("importing");
    void sendFrom(failedBatchRef.current, runRef.current);
  };

  /** Fermer after a stopped import: what went in stays, the rest can be sent another time. */
  const closeAfterError = async () => {
    resultToast(talliesRef.current);
    onOpenChange(false);
    await onImported();
  };

  const importing = step === "importing";
  const inReview = step === "review" || importing || step === "importError";
  const title = inReview ? ti.reviewTitle : ti.title;
  const canImport = selectedCount > 0 && incompleteSelected === 0;
  const importingLabel = `${ti.importing} ${progress?.done ?? 0}/${progress?.total ?? 0}…`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape, the overlay and the X must not drop a batch still in flight.
        if (!next && step === "importing") return;
        if (!next && step === "importError") {
          void closeAfterError();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-4 p-4 sm:max-w-3xl sm:p-6"
        onDragOver={swallowDrag}
        onDrop={swallowDrag}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="pr-8">{title}</DialogTitle>
        </DialogHeader>

        <div
          ref={listRef}
          className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
        >
          {step === "pick" ? (
            <div className="space-y-4">
              {pending ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
                    <span className="flex-1">
                      {ti.pendingList} {pending.count} {ti.pendingListTail}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={resumePending}
                    >
                      <RotateCcw />
                      {ti.resumeList}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-destructive hover:text-destructive"
                      onClick={abandonPending}
                    >
                      {ti.abandonList}
                    </Button>
                  </div>
                  {persisted === false ? (
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{ti.notSaved}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <div
                  onDragEnter={onDragOver}
                  onDragOver={onDragOver}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`flex min-h-[11rem] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragOver ? "border-primary bg-accent" : "border-border bg-muted/30"}`}
                >
                  <Upload className="pointer-events-none h-8 w-8 text-muted-foreground" />
                  <p className="pointer-events-none text-sm font-medium">
                    {ti.dropHere}
                  </p>
                </div>
              )}
              {pickError ? (
                <p className="flex items-start gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{pickError}</span>
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {pending ? null : (
                  <Tile
                    icon={FileUp}
                    label={ti.chooseFile}
                    onClick={() => fileRef.current?.click()}
                  />
                )}
                <Tile
                  icon={Camera}
                  label={t.contacts.addWithAssistant}
                  onClick={openAssistant}
                />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.zip,.abbu"
                className="hidden"
                onChange={onFilesPicked}
              />
              <p className="text-xs text-muted-foreground">{ti.hint}</p>
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                <Download className="h-4 w-4" />
                {ti.csvTemplate}
              </button>
            </div>
          ) : null}

          {step === "reading" ? (
            <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">
                {progress
                  ? `${ti.readingArchive} ${progress.done}/${progress.total} ${ti.records}`
                  : ti.reading}
              </p>
            </div>
          ) : null}

          {step === "review" && summary ? (
            <div className="space-y-4">
              <p className="text-sm">
                <span className="font-medium">
                  {rows.length} {ti.newContacts}
                </span>
                <span className="text-muted-foreground">
                  {" · "}
                  {summary.alreadyPresent} {ti.alreadyPresent}
                  {" · "}
                  {summary.withoutEmail} {ti.withoutEmail}
                  {summary.duplicatesInFile > 0
                    ? ` · ${summary.duplicatesInFile} ${ti.duplicatesMerged}`
                    : ""}
                </span>
              </p>
              {summary.source === "csv" && summary.newGroupNames.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {summary.newGroupNames.length} {ti.newGroupsToCreate}{" "}
                  {summary.newGroupNames.join(", ")}
                </p>
              ) : null}

              {rows.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => selectAll(true)}
                    >
                      {ti.selectAll}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => selectAll(false)}
                    >
                      {ti.deselectAll}
                    </Button>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {selectedCount} {t.contacts.selected}
                    </span>
                  </div>
                  <p
                    id={hintId}
                    className="hidden text-xs text-muted-foreground [@media(hover:hover)]:block"
                  >
                    {ti.keyboardHint}
                  </p>
                  {resumed ? (
                    <p className="text-xs text-muted-foreground">
                      {ti.resumed} {savedAtLabel(resumed.savedAt)}
                      {resumed.dropped > 0
                        ? ` · ${resumed.dropped} ${ti.droppedSince}`
                        : ""}
                    </p>
                  ) : null}
                  {persisted === false ? (
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{ti.notSaved}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {ti.autoSaved}
                    </p>
                  )}

                  {incompleteSelected > 0 ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="flex-1">
                        {incompleteSelected} {ti.missingNames}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={autofill}
                      >
                        <Sparkles />
                        {ti.autofill}
                      </Button>
                    </div>
                  ) : null}

                  <div className="space-y-2" onKeyDown={onListKeyDown}>
                    {pageRows.map((row) => (
                      <ImportRow
                        key={row.c.id}
                        row={row}
                        focused={row.c.id === focusedId}
                        hintId={hintId}
                        onSelect={setSelected}
                        onName={setName}
                        onFocusRow={onFocusRow}
                        registerRef={registerRef}
                      />
                    ))}
                  </div>

                  {totalPages > 1 ? (
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        {(currentPage - 1) * PAGE_SIZE + 1}-
                        {Math.min(currentPage * PAGE_SIZE, rows.length)}{" "}
                        {t.contacts.paginationOf} {rows.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => goToPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="px-3 tabular-nums">
                          {currentPage} / {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() =>
                            goToPage(Math.min(totalPages, currentPage + 1))
                          }
                          disabled={currentPage === totalPages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {importing ? (
            <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">{importingLabel}</p>
            </div>
          ) : null}

          {step === "importError" && stop ? (
            <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm">
                {stop.created} {ti.imported}, {stop.remaining} {ti.remaining}.{" "}
                {ti.stopped} {stop.message}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          {step === "review" ? (
            <Button
              variant="outline"
              onClick={goBack}
              className="h-10 sm:mr-auto"
            >
              <ArrowLeft />
              {ti.back}
            </Button>
          ) : null}
          {step === "importError" ? (
            <>
              <Button
                variant="outline"
                onClick={() => void closeAfterError()}
                className="h-10"
              >
                {ti.close}
              </Button>
              <Button
                onClick={retry}
                className="h-10 gradient-terracotta text-white hover:opacity-90"
              >
                <RotateCcw />
                {ti.retry}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={importing}
              className="h-10"
            >
              {ti.cancel}
            </Button>
          )}
          {step === "review" || importing ? (
            <Button
              onClick={() => void startImport()}
              disabled={!canImport || importing}
              className="h-10 gradient-terracotta text-white hover:opacity-90"
            >
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              {importing
                ? importingLabel
                : `${ti.import} ${selectedCount} ${ti.contactsUnit}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
