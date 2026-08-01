import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LexArtifactType,
  LexCitationEvent,
  LexDocument,
  LexMessage,
  LexTask
} from "@packages/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea
} from "@packages/ui";
import {
  ArrowLeft,
  AudioLines,
  Brain,
  CalendarClock,
  Copy,
  Eye,
  Files,
  FileText,
  FolderUp,
  Loader2,
  Mic,
  Pencil,
  Pin,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Send,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import DocumentViewerDialog from "@/components/lex/DocumentViewerDialog";
import { MarkdownMessage } from "@/components/lex/MarkdownMessage";
import PinnedDocumentsPanel from "@/components/lex/PinnedDocumentsPanel";
import TaskPanel from "@/components/lex/TaskPanel";
import { useLanguage } from "@/contexts/LanguageContext";
import { useThrottled } from "@/hooks/use-throttled";
import { useToast } from "@/hooks/use-toast";
import {
  formatDuration,
  MAX_RECORDING_SECONDS,
  useVoiceRecorder
} from "@/hooks/use-voice-recorder";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { streamLexMessage } from "@/lib/lexStream";
import { useCollection, useEntity } from "@/store/hooks";
import { useLexControllers } from "@/store/LexStoreProvider";
import VoiceNoteDialog from "./VoiceNoteDialog";

// Ingestion is still running while a document is in any of these states — poll until it settles.
const IN_PROGRESS: ReadonlySet<LexDocument["parseStatus"]> = new Set([
  "uploaded",
  "parsing",
  "transcribing",
  "chunking",
  "embedding",
  "summarizing"
]);

/**
 * States that mean "this document is not part of the working case file": nothing was uploaded,
 * it could not be parsed, or it is a copy of another. Hidden by default.
 */
const PROBLEM_STATUS: ReadonlySet<LexDocument["parseStatus"]> = new Set([
  "awaiting_upload",
  "failed",
  "needs_ocr",
  "duplicate"
]);

// Mirrors isAudio() in the backend's document-parser: some browsers/OSes upload audio as
// application/octet-stream, so the extension is checked too.
const AUDIO_EXT_RE =
  /\.(webm|m4a|mp3|mp4|mpga|mpeg|wav|ogg|oga|opus|flac|aac)$/i;

/** The year a document sits at on the case timeline, or null when it has no extracted date. */
function yearOf(doc: LexDocument | undefined): string | null {
  return doc?.timelineDate ? doc.timelineDate.slice(0, 4) : null;
}

/** A voice note: an audio document, whose text came from transcription. */
function isVoiceNote(doc: LexDocument): boolean {
  return (
    (doc.contentType ?? "").toLowerCase().startsWith("audio/") ||
    AUDIO_EXT_RE.test(doc.filename)
  );
}

/**
 * A user message longer than this is collapsed behind a "show more". Pasting a whole letter or
 * an excerpt of a filing is normal here, and an uncollapsed one buries the assistant's answer.
 */
const LONG_MESSAGE_CHARS = 900;

const UserMessage = memo(function UserMessage({
  content
}: {
  content: string;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > LONG_MESSAGE_CHARS;
  const shown =
    isLong && !expanded ? `${content.slice(0, LONG_MESSAGE_CHARS)}…` : content;

  return (
    <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap bg-sidebar-primary text-sidebar-primary-foreground">
      {shown}
      {isLong ? (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1.5 block text-xs underline opacity-80 hover:opacity-100"
        >
          {expanded ? t.lex.showLess : t.lex.showMore}
        </button>
      ) : null}
    </div>
  );
});

/**
 * A document (optionally specific pages) the user pinned from the viewer. Sent as a structured
 * pin, not prose — the server reads exactly these pages and puts them first among the sources.
 */
interface DocRef {
  documentId: string;
  filename: string;
  /** Empty = the whole document. */
  pages: number[];
}

const StatusBadge = memo(function StatusBadge({
  status
}: {
  status: LexDocument["parseStatus"];
}) {
  const base =
    "text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 shrink-0";
  if (status === "ready")
    return <span className={`${base} bg-green-100 text-green-700`}>ready</span>;
  if (status === "failed")
    return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  if (status === "needs_ocr")
    return <span className={`${base} bg-amber-100 text-amber-700`}>OCR</span>;
  if (status === "duplicate")
    return (
      <span className={`${base} bg-purple-100 text-purple-700`}>duplicate</span>
    );
  if (status === "awaiting_upload")
    return (
      <span className={`${base} bg-blue-100 text-blue-700`}>
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        upload
      </span>
    );
  return (
    <span className={`${base} bg-blue-100 text-blue-700`}>
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      {status}
    </span>
  );
});

/** One document in the panel. Shared by primaries and their nested duplicates. */
const DocumentRow = memo(function DocumentRow({
  doc,
  isDuplicate = false,
  selected,
  onSelect,
  onOpen,
  onPin,
  isPinned,
  onReference,
  onRetry
}: {
  doc: LexDocument;
  isDuplicate?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (doc: LexDocument) => void;
  onPin: (doc: LexDocument) => void;
  isPinned: boolean;
  onReference: (doc: LexDocument) => void;
  onRetry: (id: string) => void;
}) {
  const { t } = useLanguage();
  const audio = isVoiceNote(doc);
  // Nothing was ever uploaded for these, so there is nothing to open or retry.
  const neverUploaded = doc.parseStatus === "awaiting_upload";

  // Two lines and one row of icon actions. Tags are deliberately NOT shown here: a 68-document
  // case file has to be scannable, and three tag chips per row tripled the height of the panel.
  // They live on the documents page, and the search box above still matches on them.
  return (
    <div className="group px-2 py-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(doc.id)}
          aria-label={doc.filename}
          className="shrink-0"
        />
        {audio ? (
          <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className="font-medium truncate min-w-0 flex-1"
          title={doc.filename}
        >
          {doc.filename}
        </span>

        {/* Three distinct actions, deliberately:
              PIN       — holds the document open as a tab in the right panel, to work from while
                          asking questions; that panel is where PAGES are picked and sent to chat.
              OPEN      — a one-off read in a modal, full size, no decisions attached.
              REFERENCE — attach the WHOLE document to the next question, in one click, without
                          opening anything. Deleting is not here on purpose: it lives behind the
                          checkbox selection, where it takes a deliberate second step.
            Icons only, on hover, so a resting row is just the document. */}
        <span className="flex items-center gap-1 shrink-0">
          <span className="group-hover:hidden">
            {doc.parseStatus === "ready" ? null : (
              <StatusBadge status={doc.parseStatus} />
            )}
          </span>
          <span className="hidden group-hover:flex items-center gap-1.5">
            {!neverUploaded ? (
              <button
                onClick={() => onPin(doc)}
                title={t.lex.pinDocument}
                aria-label={t.lex.pinDocument}
                className={
                  isPinned
                    ? "text-sidebar-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {!neverUploaded ? (
              <button
                onClick={() => onOpen(doc)}
                title={audio ? t.lex.openVoiceNote : t.lex.viewDocument}
                aria-label={audio ? t.lex.openVoiceNote : t.lex.viewDocument}
                className="text-muted-foreground hover:text-foreground"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {doc.parseStatus === "failed" || doc.parseStatus === "needs_ocr" ? (
              <button
                onClick={() => onRetry(doc.id)}
                title={t.lex.retry}
                aria-label={t.lex.retry}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {doc.parseStatus === "ready" ? (
              <button
                onClick={() => onReference(doc)}
                title={t.lex.addReference}
                aria-label={t.lex.addReference}
                className="text-muted-foreground hover:text-foreground"
              >
                <Quote className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
        </span>
      </div>

      <div className="pl-[1.35rem] text-[11px] text-muted-foreground truncate">
        {isDuplicate ? `${t.lex.duplicateOf} ↑ · ` : ""}
        {doc.timelineDate ?? t.lex.noDate}
        {doc.language ? ` · ${doc.language.toUpperCase()}` : ""}
        {doc.durationSeconds ? ` · ${formatDuration(doc.durationSeconds)}` : ""}
      </div>
      {doc.parseStatus === "failed" && doc.error ? (
        <p className="pl-[1.35rem] text-[11px] text-destructive truncate">
          {doc.error}
        </p>
      ) : null}
    </div>
  );
});

const SourceChips = memo(function SourceChips({
  citations
}: {
  citations: LexCitationEvent[];
}) {
  const { t } = useLanguage();
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span className="text-xs text-muted-foreground mr-1">
        {t.lex.sources}:
      </span>
      {citations.map((c) => (
        <span
          key={`${c.chunkId}-${c.index ?? 0}`}
          title={c.quote ?? ""}
          className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground/80"
        >
          [{c.index ?? "?"}] {c.filename ?? "source"}
          {c.pageFrom ? `, p.${c.pageFrom}` : ""}
        </span>
      ))}
    </div>
  );
});

/**
 * The workspace, redesigned around a single lawyer-agent chat. The left panel accumulates the
 * case documents (upload, view, reference); the center is one long conversation with source
 * citations; documents can be pinned as focus references, and a chat action generates a
 * citation-anchored artifact from the case. Reads come from the normalized store via
 * useCollection/useEntity; writes go through controllers.
 */
export default function LexWorkspaceChat() {
  const { id = "" } = useParams();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const controllers = useLexControllers();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Synchronous in-flight flag for sending — see the note in handleSend.
  const sendingRef = useRef(false);

  const workspace = useEntity("lexWorkspaces", id);

  const docFilter = useCallback((d: LexDocument) => d.workspaceId === id, [id]);
  const documents = useCollection("lexDocuments", docFilter);

  // Failures, duplicates and never-uploaded rows are hidden by default: a 65-file folder drop
  // produces a handful of each, and they are noise while working the case. They stay reachable
  // (and disposable) behind the toggle.
  const [showProblems, setShowProblems] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);

  const problemCount = useMemo(
    () => documents.filter((d) => PROBLEM_STATUS.has(d.parseStatus)).length,
    [documents]
  );

  const [docQuery, setDocQuery] = useState("");

  /**
   * Documents for display: filtered by the search box, ordered along the case timeline, each
   * primary carrying the duplicates that point at it so both copies show on one line.
   *
   * Ordering is CHRONOLOGICAL ASCENDING, matching the timeline view — a case file reads
   * oldest-first, and the panel disagreeing with the timeline page was a quiet inconsistency.
   * Documents with no extracted date sort last: they are undated, not ancient.
   */
  const docGroups = useMemo(() => {
    const needle = docQuery.trim().toLowerCase();
    const matches = (d: LexDocument) =>
      needle.length === 0 ||
      d.filename.toLowerCase().includes(needle) ||
      (d.timelineDate ?? "").includes(needle) ||
      d.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
      d.keyNames.some((name) => name.toLowerCase().includes(needle));

    const dupesByPrimary = new Map<string, LexDocument[]>();
    for (const d of documents) {
      if (!d.duplicateOf) continue;
      const list = dupesByPrimary.get(d.duplicateOf) ?? [];
      list.push(d);
      dupesByPrimary.set(d.duplicateOf, list);
    }

    return documents
      .filter((d) => showProblems || !PROBLEM_STATUS.has(d.parseStatus))
      .filter((d) => !d.duplicateOf) // duplicates render nested under their primary
      .filter(matches)
      .sort((a, b) => {
        // Undated last, then oldest first.
        if (!a.timelineDate && !b.timelineDate)
          return a.createdAt.localeCompare(b.createdAt);
        if (!a.timelineDate) return 1;
        if (!b.timelineDate) return -1;
        return a.timelineDate.localeCompare(b.timelineDate);
      })
      .map((primary) => ({
        primary,
        duplicates: dupesByPrimary.get(primary.id) ?? []
      }));
  }, [documents, showProblems, docQuery]);

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const msgFilter = useCallback(
    (m: LexMessage) =>
      m.conversationId === activeConvId && m.status !== "pending",
    [activeConvId]
  );
  const messagesRaw = useCollection("lexMessages", msgFilter);
  const messages = useMemo(
    () => [...messagesRaw].sort((a, b) => a.seq - b.seq),
    [messagesRaw]
  );

  const [refs, setRefs] = useState<DocRef[]>([]);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamCitations, setStreamCitations] = useState<LexCitationEvent[]>(
    []
  );
  // Citations for persisted assistant messages (the messages endpoint doesn't carry them).
  const [citationsByMessage, setCitationsByMessage] = useState<
    Record<string, LexCitationEvent[]>
  >({});

  // Markdown is re-parsed whenever the text changes, so the streamed reply is throttled rather
  // than re-rendered on every token.
  const throttledStreamText = useThrottled(streamText, 60);

  // Background assessments for this workspace. Live ones are polled so a task launched in another
  // tab (or before a reload) still appears here.
  const taskFilter = useCallback(
    (task: LexTask) => task.workspaceId === id,
    [id]
  );
  const tasks = useCollection("lexTasks", taskFilter);
  const activeTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) => task.status === "queued" || task.status === "running")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [tasks]
  );

  useEffect(() => {
    controllers.tasks.loadForWorkspace(id).catch(() => {
      /* the panel simply stays empty */
    });
  }, [controllers, id]);

  /**
   * Deep mode is a property of the NEXT message, not a separate feature behind a dialog: you type
   * the question you would have asked anyway, turn this on, and send. A normal turn answers from
   * retrieval in seconds; a deep turn reads every document in the case file and takes minutes, so
   * it runs in the background and posts its answer back into this conversation.
   */
  const [deepMode, setDeepMode] = useState(false);

  // Older messages exist beyond the loaded page (a years-long thread is never fetched whole).
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const handleLoadOlder = async () => {
    if (loadingOlder || messages.length === 0 || !activeConvId) return;
    setLoadingOlder(true);
    try {
      const { hasMore } = await controllers.conversations.loadMessages(
        activeConvId,
        messages[0].seq
      );
      setHasOlder(hasMore);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setLoadingOlder(false);
    }
  };

  // Inline rename of the case. null = not editing.
  const [editingName, setEditingName] = useState<string | null>(null);
  const commitName = async () => {
    const next = (editingName ?? "").trim();
    setEditingName(null);
    if (!next || next === workspace?.name) return;
    try {
      await controllers.workspaces.rename(id, next);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  // Voice notes: dictate into the chat, then open one to re-listen / correct its transcript.
  const recorder = useVoiceRecorder();
  const [openVoiceNote, setOpenVoiceNote] = useState<LexDocument | null>(null);
  // The document open in the modal viewer — a one-off look.
  const [openDoc, setOpenDoc] = useState<LexDocument | null>(null);
  // Documents held open as tabs in the right-hand panel, and which tab is showing.
  const [pinnedDocs, setPinnedDocs] = useState<LexDocument[]>([]);
  const [activePinnedId, setActivePinnedId] = useState<string | null>(null);

  // Generate-artifact dialog state.
  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState<LexArtifactType>("memo");
  const [genTitle, setGenTitle] = useState("");
  const [genInstructions, setGenInstructions] = useState("");
  const [generating, setGenerating] = useState(false);

  // Initial load: workspace + documents + the (single) most recent conversation and its messages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          controllers.workspaces.load(id),
          controllers.documents.loadForWorkspace(id)
        ]);
        const convs = await controllers.conversations.loadForWorkspace(id);
        if (cancelled || convs.length === 0) return;
        const active = [...convs].sort((a, b) =>
          (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
        )[0];
        setActiveConvId(active.id);
        const { hasMore } = await controllers.conversations.loadMessages(
          active.id
        );
        if (!cancelled) setHasOlder(hasMore);
      } catch (err) {
        if (!cancelled) toast({ title: String(err), variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, controllers, toast]);

  // Poll while any document is still ingesting.
  const anyInProgress = useMemo(
    () => documents.some((d) => IN_PROGRESS.has(d.parseStatus)),
    [documents]
  );
  useEffect(() => {
    if (!anyInProgress) return;
    const timer = setInterval(() => {
      controllers.documents.loadForWorkspace(id).catch(() => {
        /* ignore transient polling errors */
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [anyInProgress, controllers, id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText, pendingUser]);

  /**
   * Files (or a whole folder) go straight to S3. Nothing is silently dropped: rejects and
   * failures are reported, and the folder path is folded into each filename so a flattened
   * document is still identifiable in the timeline and in citations.
   */
  const handleUpload = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    try {
      const outcome = await controllers.documents.upload(
        id,
        files,
        (done, total) => setUploadProgress({ done, total })
      );
      const problems = [
        ...outcome.rejected.map((r) => `${r.filename} (${t.lex.tooLarge})`),
        ...outcome.failed
      ];
      if (problems.length > 0) {
        toast({
          title: `${t.lex.uploadPartial} — ${problems.slice(0, 3).join(", ")}${problems.length > 3 ? "…" : ""}`,
          variant: "destructive"
        });
      }
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // The raw Markdown is copied, not the rendered text: it pastes into a document keeping its
  // headings, lists and tables, and it is exactly what the assistant produced.
  const handleCopyMessage = async (content: string) => {
    const ok = await copyToClipboard(content);
    toast(
      ok
        ? { title: t.lex.copied }
        : { title: t.lex.copyFailed, variant: "destructive" }
    );
  };

  const handleCopyConversation = async () => {
    const transcript = messages
      .map(
        (m) => `${m.role === "user" ? t.lex.you : t.lex.title}:\n${m.content}`
      )
      .join("\n\n---\n\n");
    const ok = await copyToClipboard(transcript);
    toast(
      ok
        ? { title: t.lex.copied }
        : { title: t.lex.copyFailed, variant: "destructive" }
    );
  };

  const handleStartRecording = async () => {
    try {
      await recorder.start();
    } catch {
      // Almost always a denied/absent microphone.
      toast({ title: t.lex.micDenied, variant: "destructive" });
    }
  };

  /** Stops the recording and files it as a document (ingestion transcribes it). */
  const handleStopRecording = async () => {
    const file = await recorder.stop();
    if (!file) return;
    setUploading(true);
    try {
      // Timestamped so the panel doesn't fill up with identically-named notes.
      const ext = file.name.split(".").pop() ?? "webm";
      const stamp = new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")
        .replace(":", "h");
      const named = new File([file], `${t.lex.voiceNote} ${stamp}.${ext}`, {
        type: file.type
      });
      // Same direct-to-S3 path as any other document — one upload path, no exceptions.
      await controllers.documents.upload(id, [named]);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  /**
   * Holds a document open as a tab in the right-hand panel, and focuses it. Pinning is about
   * keeping a document to hand; the pages sent to the chat come from that panel.
   */
  const pinDocument = useCallback((doc: LexDocument) => {
    setPinnedDocs((prev) =>
      prev.some((d) => d.id === doc.id) ? prev : [...prev, doc]
    );
    setActivePinnedId(doc.id);
  }, []);

  const unpinDocument = useCallback((documentId: string) => {
    setPinnedDocs((prev) => prev.filter((d) => d.id !== documentId));
    setActivePinnedId((prev) => (prev === documentId ? null : prev));
  }, []);

  /**
   * "Send to chat" from a pinned document (or from the modal viewer): the chosen pages become a
   * reference attached to the question being composed. Replaces any earlier reference to the same
   * document, so sending twice does not stack two entries for one file.
   */
  const referenceInChat = useCallback(
    (documentId: string, filename: string, pages: number[]) => {
      setRefs((prev) => [
        ...prev.filter((r) => r.documentId !== documentId),
        { documentId, filename, pages }
      ]);
    },
    []
  );

  /** One-click: attach the whole document to the next question, no viewer, no page picking. */
  const referenceWholeDocument = useCallback(
    (doc: LexDocument) => referenceInChat(doc.id, doc.filename, []),
    [referenceInChat]
  );

  const handleRetryDoc = useCallback(
    async (docId: string) => {
      try {
        await controllers.documents.retry(docId);
      } catch (err) {
        toast({ title: String(err), variant: "destructive" });
      }
    },
    [controllers, toast]
  );

  const toggleDocSelected = useCallback((docId: string) => {
    setSelectedDocs((prev) =>
      prev.includes(docId) ? prev.filter((s) => s !== docId) : [...prev, docId]
    );
  }, []);

  const handleDeleteSelected = async () => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    const ids = selectedDocs;
    try {
      await controllers.documents.removeMany(ids);
      setSelectedDocs([]);
      setRefs((prev) => prev.filter((r) => !ids.includes(r.documentId)));
      // A deleted document must not stay pinned: its tab would 404 on the next activation.
      setPinnedDocs((prev) => prev.filter((d) => !ids.includes(d.id)));
      setActivePinnedId((prev) => (prev && ids.includes(prev) ? null : prev));
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  /** Clears every never-uploaded / unparseable / duplicate document in one action. */
  const handleDiscardProblems = async () => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    try {
      const { deleted } = await controllers.documents.discard(id, [
        "awaiting_upload",
        "failed",
        "duplicate"
      ]);
      toast({ title: `${t.lex.discarded} (${deleted})` });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const removeRef = (documentId: string) =>
    setRefs((prev) => prev.filter((r) => r.documentId !== documentId));

  /**
   * The pins are also named in the message text. Not for the model's benefit — it receives them
   * structurally — but so the persisted conversation still shows what was being looked at when
   * the question was asked, months later.
   */
  const buildContent = (text: string): string => {
    if (refs.length === 0) return text;
    const labels = refs
      .map(
        (r) =>
          `${r.filename}${r.pages.length ? ` (p.${r.pages.join(", ")})` : ""}`
      )
      .join("; ");
    return `[${t.lex.referencesLabel}: ${labels}]\n\n${text}`;
  };

  const handleSend = async () => {
    const text = input.trim();
    // The guard MUST be a ref, not the `streaming` state. React state updates are batched, so a
    // held-down or double-tapped Enter fires several keydowns within one tick, every one of them
    // seeing streaming===false and the pre-cleared `input` — which sent the same message three
    // and six times over in real use.
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");

    let convId = activeConvId;
    if (!convId) {
      try {
        const conversation = await controllers.conversations.create(
          id,
          text.slice(0, 60)
        );
        convId = conversation.id;
        setActiveConvId(convId);
      } catch (err) {
        // Release the guard, or the composer stays locked for the rest of the session.
        sendingRef.current = false;
        toast({ title: String(err), variant: "destructive" });
        return;
      }
    }

    const content = buildContent(text);

    // Deep mode: hand the question to the background runner instead of streaming a reply. It
    // reads every document in the case file, so it takes minutes — the TaskPanel above the thread
    // shows its progress and reasoning, and the answer is posted here when it lands.
    if (deepMode) {
      try {
        await controllers.tasks.create({
          workspaceId: id,
          conversationId: convId,
          kind: "assess_documents",
          // The first line is the task's label in the panel; the whole question is the brief.
          title: text.split("\n")[0].slice(0, 200),
          instructions: content
        });
        setDeepMode(false);
      } catch (err) {
        setInput(text); // don't lose a long question because the launch failed
        toast({ title: String(err), variant: "destructive" });
      } finally {
        sendingRef.current = false;
      }
      return;
    }

    // Snapshot the pins for this turn before clearing them, so an in-flight send is unaffected
    // by the user pinning something else while it streams.
    const pins = refs.map((r) => ({
      documentId: r.documentId,
      pages: r.pages
    }));
    setPendingUser(content);
    // Pins deliberately SURVIVE the send: they live in a rail the user can see, and the whole
    // point of pinning pages is to ask several questions about them. They are cleared explicitly.
    setStreaming(true);
    setStreamText("");
    setStreamCitations([]);

    let accumulated = "";
    let finalCitations: LexCitationEvent[] = [];
    try {
      await streamLexMessage(
        convId,
        content,
        {
          onToken: (delta) => {
            accumulated += delta;
            setStreamText(accumulated);
          },
          onCitations: (citations) => {
            finalCitations = citations;
            setStreamCitations(citations);
          },
          onDone: (messageId) => {
            setCitationsByMessage((prev) => ({
              ...prev,
              [messageId]: finalCitations
            }));
          },
          onError: (message) =>
            toast({ title: message, variant: "destructive" })
        },
        pins
      );
      // Pull the persisted user + assistant messages into the store, then drop the local echo.
      await controllers.conversations.loadMessages(convId);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      sendingRef.current = false;
      setStreaming(false);
      setStreamText("");
      setStreamCitations([]);
      setPendingUser(null);
    }
  };

  const handleGenerate = async () => {
    if (!genTitle.trim() || generating) return;
    setGenerating(true);
    try {
      const { artifact } = await api.lex.artifacts.generate({
        workspaceId: id,
        conversationId: activeConvId ?? undefined,
        type: genType,
        title: genTitle.trim(),
        instructions: genInstructions.trim() || undefined
      });
      navigate(`/lex/artifacts/${artifact.id}`);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* One header across the full width. The case name lives here rather than in the narrow
          documents column, where it was truncated to a couple of characters. */}
      <header className="flex items-center gap-3 pb-3 mb-3 border-b">
        <button
          onClick={() => navigate("/lex")}
          title={t.lex.back}
          aria-label={t.lex.back}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          {editingName !== null ? (
            <Input
              value={editingName}
              autoFocus
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => void commitName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitName();
                }
                if (e.key === "Escape") setEditingName(null);
              }}
              className="h-8 font-serif font-bold"
            />
          ) : (
            <button
              onClick={() => setEditingName(workspace?.name ?? "")}
              title={t.lex.renameWorkspace}
              className="group/name flex items-center gap-2 min-w-0 max-w-full text-left"
            >
              <h1 className="text-lg font-serif font-bold truncate">
                {workspace?.name ?? t.lex.title}
              </h1>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity" />
            </button>
          )}
          <p className="text-xs text-muted-foreground truncate">
            {t.lex.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/lex/workspaces/${id}/documents`)}
          >
            <Files className="h-4 w-4 mr-1.5" />
            {t.lex.allDocuments}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/lex/workspaces/${id}/story`)}
          >
            <CalendarClock className="h-4 w-4 mr-1.5" />
            {t.lex.story.tab}
          </Button>
          {messages.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyConversation()}
              title={t.lex.copyConversation}
              aria-label={t.lex.copyConversation}
            >
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => setGenOpen(true)}
            className="gradient-terracotta text-white"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {t.lex.newArtifact}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 min-h-0">
        {/* Documents panel */}
        <aside className="w-72 shrink-0 flex flex-col border-r pr-3">
          <div className="mb-3 space-y-1.5">
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {uploading ? t.lex.uploading : t.lex.uploadDocument}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                title={t.lex.uploadFolder}
                aria-label={t.lex.uploadFolder}
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderUp className="h-4 w-4" />
              </Button>
            </div>
            {uploadProgress && uploadProgress.total > 1 ? (
              <p className="text-[11px] text-muted-foreground">
                {uploadProgress.done}/{uploadProgress.total}
              </p>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.md,.txt,.jpg,.jpeg,.png,.m4a,.mp3,.wav,.webm,.ogg"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
          {/* webkitdirectory: the browser hands back every file in the folder tree, each carrying
            its relative path — flattened into the filename by toUploadCandidates. */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            /* @ts-expect-error -- webkitdirectory is not in React's HTML types but is required. */
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleUpload(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Search across filename, tags, key names and the timeline date. */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder={t.lex.searchDocuments}
              className="h-8 pl-8 text-xs"
            />
            {docQuery ? (
              <button
                onClick={() => setDocQuery("")}
                aria-label={t.lex.clearSelection}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Selection + problem-document controls */}
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            {selectedDocs.length > 0 ? (
              <>
                <span className="text-muted-foreground">
                  {selectedDocs.length} {t.lex.selected}
                </span>
                <button
                  onClick={() => void handleDeleteSelected()}
                  className="inline-flex items-center gap-1 text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  {t.lex.delete}
                </button>
                <button
                  onClick={() => setSelectedDocs([])}
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  {t.lex.clearSelection}
                </button>
              </>
            ) : problemCount > 0 ? (
              <>
                <button
                  onClick={() => setShowProblems((prev) => !prev)}
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  {showProblems
                    ? t.lex.hideProblems
                    : `${t.lex.showProblems} (${problemCount})`}
                </button>
                {showProblems ? (
                  <button
                    onClick={() => void handleDiscardProblems()}
                    className="inline-flex items-center gap-1 text-destructive hover:underline ml-auto"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t.lex.discardProblems}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex-1 overflow-auto space-y-1.5">
            {docGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground px-1">
                {t.lex.noDocuments}
              </p>
            ) : (
              docGroups.map(({ primary, duplicates }, index) => (
                <div key={primary.id} className="rounded-lg border bg-card">
                  {/* A subtle year marker where the year changes — enough to read the panel as a
                      chronology without turning it into a full timeline widget. */}
                  {yearOf(primary) !== yearOf(docGroups[index - 1]?.primary) ? (
                    <div className="px-2.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                      {yearOf(primary) ?? t.lex.noDate}
                    </div>
                  ) : null}
                  <DocumentRow
                    doc={primary}
                    selected={selectedDocs.includes(primary.id)}
                    onSelect={toggleDocSelected}
                    onOpen={(d) =>
                      isVoiceNote(d) ? setOpenVoiceNote(d) : setOpenDoc(d)
                    }
                    onPin={pinDocument}
                    isPinned={pinnedDocs.some((p) => p.id === primary.id)}
                    onReference={referenceWholeDocument}
                    onRetry={handleRetryDoc}
                  />
                  {/* Duplicates sit with their primary so both copies are visible at once and
                      either can be deleted — which is the decision the user actually has. */}
                  {duplicates.map((dupe) => (
                    <div
                      key={dupe.id}
                      className="border-t bg-muted/40 pl-3 rounded-b-lg"
                    >
                      <DocumentRow
                        doc={dupe}
                        isDuplicate
                        selected={selectedDocs.includes(dupe.id)}
                        onSelect={toggleDocSelected}
                        onOpen={(d) =>
                          isVoiceNote(d) ? setOpenVoiceNote(d) : setOpenDoc(d)
                        }
                        onPin={pinDocument}
                        isPinned={pinnedDocs.some((p) => p.id === dupe.id)}
                        onReference={referenceWholeDocument}
                        onRetry={handleRetryDoc}
                      />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Running assessments sit above the thread: they are long-lived and their result
              lands in this conversation, so they belong in view rather than in a side panel. */}
          {activeTasks.length > 0 ? (
            <div className="mb-3 space-y-2">
              {activeTasks.map((task) => (
                <TaskPanel
                  key={task.id}
                  task={task}
                  onClose={() => void controllers.tasks.refresh(task.id)}
                />
              ))}
            </div>
          ) : null}

          <div ref={scrollRef} className="flex-1 overflow-auto space-y-4 pr-2">
            {messages.length === 0 && !streaming && !pendingUser ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                {t.lex.askPlaceholder}
              </div>
            ) : null}

            {hasOlder ? (
              <div className="flex justify-center">
                <button
                  onClick={() => void handleLoadOlder()}
                  disabled={loadingOlder}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {loadingOlder ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  {t.lex.loadEarlier}
                </button>
              </div>
            ) : null}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <UserMessage content={m.content} />
                </div>
              ) : (
                <div key={m.id} className="group flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-card border">
                    <MarkdownMessage
                      content={m.content}
                      citations={citationsByMessage[m.id] ?? []}
                    />
                    <SourceChips citations={citationsByMessage[m.id] ?? []} />
                    <div className="mt-1.5 flex justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => void handleCopyMessage(m.content)}
                        title={t.lex.copy}
                        aria-label={t.lex.copy}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />
                        {t.lex.copy}
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}

            {pendingUser ? (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap bg-sidebar-primary text-sidebar-primary-foreground">
                  {pendingUser}
                </div>
              </div>
            ) : null}

            {streaming ? (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-card border">
                  {throttledStreamText ? (
                    <MarkdownMessage
                      content={throttledStreamText}
                      citations={streamCitations}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t.lex.thinking}
                    </span>
                  )}
                  <SourceChips citations={streamCitations} />
                </div>
              </div>
            ) : null}
          </div>

          {refs.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">
                {t.lex.referencesLabel}:
              </span>
              {refs.map((r) => (
                <span
                  key={r.documentId}
                  className="inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-0.5 rounded-full bg-muted"
                >
                  <span className="max-w-[10rem] truncate">{r.filename}</span>
                  <span className="text-muted-foreground">
                    {r.pages.length
                      ? `p. ${r.pages.join(", ")}`
                      : t.lex.wholeDocument}
                  </span>
                  <button
                    onClick={() => removeRef(r.documentId)}
                    aria-label={t.lex.removeReference}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {recorder.isRecording ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />
              <span className="text-sm">{t.lex.recording}</span>
              <span className="text-sm font-mono text-muted-foreground">
                {formatDuration(recorder.elapsed)} /{" "}
                {formatDuration(MAX_RECORDING_SECONDS)}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={recorder.cancel}
              >
                {t.lex.cancel}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleStopRecording()}
                className="gradient-terracotta text-white"
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                {t.lex.stopRecording}
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-end gap-2">
                {/* Multi-line: pasting a draft letter or a passage of a filing is a normal action
                    here, and a single-line input made that unreadable. Enter sends, Shift+Enter
                    inserts a newline. */}
                <Textarea
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    deepMode ? t.lex.deepPlaceholder : t.lex.askPlaceholder
                  }
                  disabled={streaming}
                  className="min-h-10 max-h-48 resize-y"
                />
                {recorder.isSupported ? (
                  <Button
                    variant="outline"
                    onClick={() => void handleStartRecording()}
                    disabled={streaming || uploading}
                    title={t.lex.recordVoiceNote}
                    aria-label={t.lex.recordVoiceNote}
                    className="shrink-0"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button
                  onClick={() => void handleSend()}
                  disabled={streaming || !input.trim()}
                  className="gradient-terracotta text-white shrink-0"
                >
                  {streaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Deep mode: a property of the next message, in the composer where the question is
                  written — not a separate action elsewhere in the UI. */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDeepMode((prev) => !prev)}
                  aria-pressed={deepMode}
                  title={t.lex.deepAssessmentHint}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    deepMode
                      ? "border-sidebar-primary bg-sidebar-primary/10 text-sidebar-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Brain className="h-3.5 w-3.5" />
                  {t.lex.deepAssessment}
                </button>
                {deepMode ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t.lex.deepModeOn}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {/* Pinned documents: held open as tabs beside the conversation. Pages ticked here are
            sent to the chat as structured references. */}
        <PinnedDocumentsPanel
          docs={pinnedDocs}
          activeId={activePinnedId}
          onActivate={setActivePinnedId}
          onClose={unpinDocument}
          onSendToChat={(doc, pages) =>
            referenceInChat(doc.id, doc.filename, pages)
          }
        />
      </div>

      {openVoiceNote ? (
        <VoiceNoteDialog
          documentId={openVoiceNote.id}
          filename={openVoiceNote.filename}
          onClose={() => setOpenVoiceNote(null)}
        />
      ) : null}

      {openDoc ? (
        <DocumentViewerDialog
          document={openDoc}
          onClose={() => setOpenDoc(null)}
        />
      ) : null}

      {/* Generate artifact dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.lex.newArtifact}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.lex.artifactType}</Label>
              <select
                value={genType}
                onChange={(e) => setGenType(e.target.value as LexArtifactType)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="memo">{t.lex.typeMemo}</option>
                <option value="chronology">{t.lex.typeChronology}</option>
                <option value="submission">{t.lex.typeSubmission}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t.lex.workspaceName}</Label>
              <Input
                value={genTitle}
                onChange={(e) => setGenTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>{t.lex.instructions}</Label>
              <Textarea
                value={genInstructions}
                onChange={(e) => setGenInstructions(e.target.value)}
                placeholder={t.lex.instructionsPlaceholder}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGenOpen(false)}
              disabled={generating}
            >
              {t.lex.cancel}
            </Button>
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating || !genTitle.trim()}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {generating ? t.lex.generating : t.lex.generate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
