import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import type {
  LexArtifactType,
  LexCitationEvent,
  LexDocument,
  LexMessage,
  LexMessageAudio,
  LexTask,
  ReasoningDepth
} from "@packages/types";
import {
  ARTIFACT_PACK_SIZE,
  DEFAULT_DEPTH,
  MAX_VOICE_MESSAGE_BYTES
} from "@packages/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea
} from "@packages/ui";
import {
  ArrowLeft,
  AudioLines,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Files,
  FileText,
  FolderOpen,
  FolderUp,
  Loader2,
  Mic,
  MoreVertical,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import DocumentViewerDialog from "@/components/lex/DocumentViewerDialog";
import { MarkdownMessage } from "@/components/lex/MarkdownMessage";
import { PanelResizer } from "@/components/lex/PanelResizer";
import PinnedDocumentsPanel from "@/components/lex/PinnedDocumentsPanel";
import TaskPanel from "@/components/lex/TaskPanel";
import VoiceMessagePlayer from "@/components/lex/VoiceMessagePlayer";
import { useLanguage } from "@/contexts/LanguageContext";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { useThrottled } from "@/hooks/use-throttled";
import { useToast } from "@/hooks/use-toast";
import {
  formatDuration,
  MAX_RECORDING_SECONDS,
  MIN_VOICE_SECONDS,
  useVoiceRecorder
} from "@/hooks/use-voice-recorder";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { matchesDocumentQuery } from "@/lib/documentInsights";
import { errorMessage } from "@/lib/errorMessage";
import { LexStreamRejected, streamLexMessage } from "@/lib/lexStream";
import {
  applyMention,
  findMention,
  stripMentions,
  textNamesDocument,
  type MentionQuery
} from "@/lib/mentions";
import { uploadVoiceMessage } from "@/lib/uploadVoiceMessage";
import { useCollection, useEntity } from "@/store/hooks";
import { useLexControllers } from "@/store/LexStoreProvider";
import VoiceNoteDialog from "./VoiceNoteDialog";

// Ingestion is still running while a document is in any of these states — poll until it settles.
/** Left to right, cheapest first — the control reads as a dial. */
const DEPTH_ORDER: ReasoningDepth[] = ["quick", "standard", "thorough"];

/**
 * How the next message is read. Exclusive: "adverse" already reads the whole file, so there is no
 * combination of these that means anything the single choice does not already say.
 */
type ChatMode = "direct" | "deep" | "adverse";
/** Left to right, cheapest and fastest first. */
const CHAT_MODES: ChatMode[] = ["direct", "deep", "adverse"];

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
/**
 * Inline panel widths, in px.
 *
 * The defaults are the fixed widths these panels had before they were draggable, so nothing moves
 * for anyone who never touches a rule. The maxima are what still leaves a workable conversation on
 * a 1280px screen with both panels open; the minima are the narrowest a filename row and a
 * rasterised PDF page stay readable at.
 */
const DOCS_WIDTH = { default: 288, min: 208, max: 560 };
const PINS_WIDTH = { default: 400, min: 288, max: 720 };
/** The conversation never gets narrower than this, whatever a rule is dragged to. */
const CHAT_MIN_WIDTH = 340;
/** The row's md:gap-4, per gap. Below md neither panel is inline, so 16 is the only value in play. */
const ROW_GAP = 16;
/** A resize rule's own width, w-px. */
const RULE_WIDTH = 1;

const AUDIO_EXT_RE =
  /\.(webm|m4a|mp3|mp4|mpga|mpeg|wav|ogg|oga|opus|flac|aac)$/i;

/**
 * The panel's group heading for a document: the day it was added.
 *
 * Keyed on the rendered label rather than on the ISO date, so the grouping cannot disagree with
 * the text — createdAt is UTC and the label is local, which near midnight would otherwise print
 * the same day twice.
 */
function addedDayOf(doc: LexDocument | undefined): string | null {
  return doc ? formatAddedAt(doc.createdAt) : null;
}

/**
 * How many files the '@' menu shows at once. More than a screenful is a list you scroll, not one
 * you pick from; the footer says how many more the query still matches.
 */
const MENTION_LIMIT = 8;
const MENTION_LIST_ID = "lex-mention-list";

/** Ceiling on the auto-grown composer, in px. Matches the max-h-48 it used to rely on. */
const COMPOSER_MAX_HEIGHT = 192;

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

/**
 * Upload time, short. The chat-side panel is ordered by it, so the order has to be readable —
 * and the year only earns its place when it is not the current one.
 */
function formatAddedAt(iso: string) {
  const added = new Date(iso);
  if (Number.isNaN(added.getTime())) return "";
  const sameYear = added.getFullYear() === new Date().getFullYear();
  return added.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" })
  });
}

/** How far from the end of the thread still counts as "at the end". One short message's worth. */
const BOTTOM_SLACK = 120;
/** How close to the top pulls the next page in without waiting for the button. */
const TOP_TRIGGER = 240;

const UserMessage = memo(function UserMessage({
  content,
  audio,
  onFileAsDocument
}: {
  content: string;
  /** Set when this turn was spoken. The text below it is the transcript. */
  audio?: LexMessageAudio | null;
  /**
   * Files the recording as a pièce. Must be useCallback-wrapped by the parent: this component is
   * memoized and the parent re-renders on every throttled token of a streaming reply, so an
   * unstable prop would re-render every bubble in the thread on every tick.
   */
  onFileAsDocument?: (audioId: string) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > LONG_MESSAGE_CHARS;
  const shown =
    isLong && !expanded ? `${content.slice(0, LONG_MESSAGE_CHARS)}…` : content;

  return (
    <div className="max-w-[90%] md:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-sidebar-primary text-sidebar-primary-foreground">
      {/* Above the text, because the recording is the message and the text is what was heard. */}
      {audio ? (
        <VoiceMessagePlayer
          audioId={audio.id}
          durationSeconds={audio.durationSeconds ?? null}
          className="mb-2"
        />
      ) : null}
      {shown}
      {isLong ? (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1.5 block text-xs underline opacity-80 hover:opacity-100"
        >
          {expanded ? t.lex.showLess : t.lex.showMore}
        </button>
      ) : null}
      {/* A spoken turn is a question, so it is not indexed or citable. When it dictated a FACT
          instead, this files it as a pièce and the case file can cite it. */}
      {audio ? (
        audio.documentId ? (
          <span className="mt-1.5 block text-[11px] opacity-70">
            {t.lex.filedAsDocument}
          </span>
        ) : onFileAsDocument ? (
          <button
            onClick={() => onFileAsDocument(audio.id)}
            className="mt-1.5 block text-xs underline opacity-80 hover:opacity-100"
          >
            {t.lex.fileAsDocument}
          </button>
        ) : null
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

/**
 * One document in the panel. Shared by primaries and their nested duplicates.
 *
 * `roomy` is the touch layout: "add to chat" gets its own line as a full-width labelled button
 * instead of being a 14px icon wedged between two other 14px icons. That icon was the most-wanted
 * action on a phone and the hardest thing on the screen to hit.
 *
 * Chosen by `!docsInline || !canHover`, so it covers two cases: the panel is a sheet (narrow), OR
 * the device cannot hover however wide it is. The second matters because the row's other actions
 * are revealed on hover, and an iPad in landscape is 1024px with no hover at all.
 */
const DocumentRow = memo(function DocumentRow({
  doc,
  isDuplicate = false,
  roomy = false,
  selected,
  onSelect,
  onOpen,
  onPin,
  isPinned,
  onReference,
  isReferenced,
  onRetry
}: {
  doc: LexDocument;
  isDuplicate?: boolean;
  roomy?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (doc: LexDocument) => void;
  onPin: (doc: LexDocument) => void;
  isPinned: boolean;
  onReference: (doc: LexDocument) => void;
  isReferenced: boolean;
  onRetry: (id: string) => void;
}) {
  const { t } = useLanguage();
  const audio = isVoiceNote(doc);
  // Nothing was ever uploaded for these, so there is nothing to open or retry.
  const neverUploaded = doc.parseStatus === "awaiting_upload";
  const ready = doc.parseStatus === "ready";
  const canRetry =
    doc.parseStatus === "failed" || doc.parseStatus === "needs_ocr";

  /**
   * Added date first, because that is what this panel is now sorted by — an order you cannot read
   * off the rows is just an order you have to trust. The document's own date follows it, still
   * marked when it has none, since which pièce is undated is a legal fact about the file.
   *
   * Tags are deliberately NOT here: a 68-document case file has to be scannable, and three tag
   * chips per row tripled the height of the panel. They live on the documents page, and the
   * search box above still matches on them.
   */
  const meta = `${isDuplicate ? `${t.lex.duplicateOf} ↑ · ` : ""}${formatAddedAt(doc.createdAt)} · ${doc.timelineDate ?? t.lex.noDate}${doc.language ? ` · ${doc.language.toUpperCase()}` : ""}${doc.durationSeconds ? ` · ${formatDuration(doc.durationSeconds)}` : ""}`;

  /* Three distinct actions, deliberately:
       PIN       — holds the document open as a tab in the right panel, to work from while asking
                   questions; that panel is where PAGES are picked and sent to chat.
       OPEN      — a one-off read in a modal, full size, no decisions attached.
       ADD       — attach the WHOLE document to the next question, in one tap, without opening
                   anything. Deleting is not here on purpose: it lives behind the checkbox
                   selection, where it takes a deliberate second step. */
  if (roomy) {
    return (
      <div className="px-2 py-2 text-sm">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(doc.id)}
            aria-label={doc.filename}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {audio ? (
                <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">
                {doc.filename}
              </span>
              {ready ? null : <StatusBadge status={doc.parseStatus} />}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {meta}
            </div>
            {doc.parseStatus === "failed" && doc.error ? (
              <p className="truncate text-[11px] text-destructive">
                {doc.error}
              </p>
            ) : null}

            {/* The action line. "Add to chat" takes the width that is left over: on a phone it is
                the reason the panel was opened, so it is the only control here that is allowed to
                be large. The rest stay 36px squares, which is still a real tap target. */}
            {!neverUploaded ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                {ready ? (
                  <button
                    type="button"
                    onClick={() => onReference(doc)}
                    aria-pressed={isReferenced}
                    className={`inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                      isReferenced
                        ? "gradient-terracotta text-white"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {isReferenced ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Quote className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {isReferenced ? t.lex.addedToChat : t.lex.addToChat}
                    </span>
                  </button>
                ) : null}
                {canRetry ? (
                  <button
                    type="button"
                    onClick={() => onRetry(doc.id)}
                    title={t.lex.retry}
                    aria-label={t.lex.retry}
                    className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-xs text-muted-foreground"
                  >
                    <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.lex.retry}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpen(doc)}
                  title={audio ? t.lex.openVoiceNote : t.lex.viewDocument}
                  aria-label={audio ? t.lex.openVoiceNote : t.lex.viewDocument}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onPin(doc)}
                  title={t.lex.pinDocument}
                  aria-label={t.lex.pinDocument}
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${
                    isPinned ? "text-sidebar-primary" : "text-muted-foreground"
                  }`}
                >
                  <Pin className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Inline column, pointer available: two lines, actions revealed on hover so sixty-eight rows
  // stay scannable.
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

        <span className="flex items-center gap-1 shrink-0">
          <span className="group-hover:hidden">
            {ready ? null : <StatusBadge status={doc.parseStatus} />}
          </span>
          {/* can-hover, not a width breakpoint: an iPad in landscape is 1024px and cannot hover, so
              these were unreachable there. On a touch screen the row shows them outright — the
              roomy layout is what handles the narrow case. */}
          <span className="flex items-center gap-1.5 can-hover:hidden can-hover:group-hover:flex can-hover:group-focus-within:flex">
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
            {canRetry ? (
              <button
                onClick={() => onRetry(doc.id)}
                title={t.lex.retry}
                aria-label={t.lex.retry}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
          {/* Always visible, hover or not: it is the action the panel exists for. */}
          {ready ? (
            <button
              onClick={() => onReference(doc)}
              aria-pressed={isReferenced}
              title={isReferenced ? t.lex.addedToChat : t.lex.addToChat}
              aria-label={isReferenced ? t.lex.addedToChat : t.lex.addToChat}
              className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
                isReferenced
                  ? "gradient-terracotta text-white"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {isReferenced ? (
                <Check className="h-3 w-3" />
              ) : (
                <Quote className="h-3 w-3" />
              )}
            </button>
          ) : null}
        </span>
      </div>

      <div className="pl-[1.35rem] text-[11px] text-muted-foreground truncate">
        {meta}
      </div>
      {doc.parseStatus === "failed" && doc.error ? (
        <p className="pl-[1.35rem] text-[11px] text-destructive truncate">
          {doc.error}
        </p>
      ) : null}
    </div>
  );
});

/**
 * The reference list for one answer: every marker in it, in order, with what it points at.
 *
 * The counterpart to the inline chips, and the reason the numbers in the text mean anything. It was
 * a row of hover-only pills before, which asked the reader to mouse over each one to discover the
 * pièce and offered nothing to click — so a reference could be read but not followed. Now each
 * entry states its marker, its pièce and its page, shows the quote, and opens the page.
 */
const SourceChips = memo(function SourceChips({
  citations,
  onTrace
}: {
  citations: LexCitationEvent[];
  onTrace?: (citation: LexCitationEvent) => void;
}) {
  const { t } = useLanguage();
  if (citations.length === 0) return null;
  // By marker, so the list reads in the order the answer cites them.
  const ordered = [...citations].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  );
  return (
    <div className="mt-3 border-t pt-2">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {t.lex.referencesLabel}
      </div>
      <ol className="space-y-1">
        {ordered.map((c) => (
          <li
            key={`${c.chunkId}-${c.index ?? 0}`}
            className="text-xs flex gap-2 items-baseline"
          >
            <span className="tabular-nums text-muted-foreground shrink-0">
              [{c.index ?? "?"}]
            </span>
            <span className="min-w-0">
              {onTrace ? (
                <button
                  type="button"
                  onClick={() => onTrace(c)}
                  className="text-left font-medium underline decoration-dotted hover:text-primary"
                  title={t.lex.openAtPage}
                >
                  {c.filename ?? "source"}
                  {c.pageFrom ? `, p.${c.pageFrom}` : ""}
                </button>
              ) : (
                <span className="font-medium">
                  {c.filename ?? "source"}
                  {c.pageFrom ? `, p.${c.pageFrom}` : ""}
                </span>
              )}
              {/* Visible, not a tooltip: the quote is what lets a reader judge whether the
                  reference actually supports the sentence without opening anything. */}
              {c.quote ? (
                <span className="text-muted-foreground italic">
                  {" — « "}
                  {c.quote}
                  {" »"}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
});

/**
 * Where the documents panel renders: an inline column when the viewport affords three columns,
 * or a left sheet behind the header's documents button when it does not. One child tree either
 * way — search text, ticked rows and scroll state live in the parent — only the container moves.
 */
function DocumentsPanelContainer({
  inline,
  open,
  onOpenChange,
  title,
  footer,
  children
}: {
  inline: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Sheet only: the inline column sits next to the composer, so it needs no way back to it. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  if (inline) {
    return (
      // Width comes from the row's variable, dragged by the rule that follows this column. The
      // fallback is the old fixed 18rem, used on the first paint. The border stays: the rule is a
      // hover affordance inside the existing gutter, not a replacement separator.
      <aside className="w-[var(--lex-docs-w,18rem)] shrink-0 flex flex-col border-r pr-3">
        {children}
      </aside>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[85vw] max-w-sm flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="text-sm">{title}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
        {footer ? <div className="border-t p-3">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The workspace, redesigned around a single lawyer-agent chat. The left panel accumulates the
 * case documents (upload, view, reference); the center is one long conversation with source
 * citations; documents can be pinned as focus references, and a chat action generates a
 * citation-anchored artifact from the case. Reads come from the normalized store via
 * useCollection/useEntity; writes go through controllers.
 */
/**
 * The three reasoning dials: WHAT KIND of read (exclusive), HOW HARD (applies to all three), and
 * for a background run WHICH pièces. Rendered inline in the composer from sm up, and inside a
 * bottom sheet below that, where three groups of pills do not fit one row: the FR labels alone
 * ("Réponse directe", "Analyse approfondie", "Thèse adverse") wrap inside their own pills and the
 * row grows to three lines, on the screen with the least vertical room.
 *
 * MODULE LEVEL, like DocumentsPanelContainer and for the same reason. Declared inside
 * LexWorkspaceChat it would be a new function identity on every render, so React would unmount and
 * remount the whole dial subtree on every keystroke and restart the sheet's animation.
 */
const ReasoningDials = memo(function ReasoningDials({
  mode,
  setMode,
  depth,
  setDepth,
  background,
  runScope,
  setRunScope,
  selectedScopeCount,
  hint,
  stacked
}: {
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  depth: ReasoningDepth;
  setDepth: (depth: ReasoningDepth) => void;
  background: boolean;
  runScope: "all" | "selected";
  setRunScope: (scope: "all" | "selected") => void;
  selectedScopeCount: number;
  /** The running sentence. Shown here in the sheet, where there is room and no tooltips. */
  hint: string;
  /** One group per row with room to tap, for the sheet. */
  stacked?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={stacked ? "space-y-3" : "flex flex-wrap items-center gap-2"}
    >
      <div
        className={`flex items-center rounded-full border p-0.5 ${stacked ? "w-full" : ""}`}
        role="group"
        aria-label={t.lex.modeLabel}
      >
        {CHAT_MODES.map((option) => {
          const active = mode === option;
          // Adverse is the only one that carries a warning colour: it is the one whose
          // input means something different, and mistaking it for a question wastes
          // minutes and money on a run that answers the wrong thing.
          const tone = active
            ? option === "adverse"
              ? "bg-destructive/10 text-destructive"
              : "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:text-foreground";
          return (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={active}
              title={t.lex.modeHint[option]}
              className={`inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${stacked ? "h-10 flex-1" : "py-1"} ${tone} ${
                active ? "font-medium" : ""
              }`}
            >
              {option === "direct" ? (
                <Send className="h-3.5 w-3.5" />
              ) : option === "deep" ? (
                <Brain className="h-3.5 w-3.5" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              {t.lex.modeName[option]}
            </button>
          );
        })}
      </div>

      {/* Depth now applies to background runs too, and means considerably more there: it
                picks the tier for the per-document pass, which is 200+ calls on a full file. */}
      <div
        className={`flex items-center rounded-full border p-0.5 ${stacked ? "w-full" : ""}`}
        role="group"
        aria-label={t.lex.depthLabel}
      >
        {DEPTH_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDepth(option)}
            aria-pressed={depth === option}
            title={
              background ? t.lex.runDepthHint[option] : t.lex.depthHint[option]
            }
            className={`rounded-full px-2.5 text-xs ${stacked ? "h-10 flex-1" : "py-1"} ${
              depth === option
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.lex.depthName[option]}
          </button>
        ))}
      </div>

      {/* Scope, shown only for background runs: it is the dial that decides whether a
                question about two pièces reads two or forty-seven. Hidden in direct mode,
                where retrieval already picks its own passages. */}
      {background ? (
        <div
          className={`flex items-center rounded-full border p-0.5 ${stacked ? "w-full" : ""}`}
          role="group"
          aria-label={t.lex.scopeLabel}
        >
          {(["all", "selected"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRunScope(option)}
              aria-pressed={runScope === option}
              title={t.lex.scopeHint[option]}
              className={
                runScope === option
                  ? "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs bg-secondary text-secondary-foreground font-medium"
                  : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              }
            >
              {option === "all" ? (
                <Files className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              )}
              {t.lex.scopeName[option]}
              {/* The count is the honest part: "Pinned" with nothing pinned is a run
                        that cannot start, and the number says so before it is launched. */}
              {option === "selected" ? ` (${selectedScopeCount})` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {stacked ? (
        <p className="pt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
});

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

  /**
   * Whether the thread is parked at its end.
   *
   * Two consumers, hence both a ref and a state: the stick-to-bottom layout effect reads it during
   * a commit (a ref, so it is never a render behind), the jump-to-latest button renders off it
   * (state). The thread used to scroll itself to the bottom on every store write, so reading a
   * passage half-way up lasted until the next token arrived.
   */
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /**
   * Distance from the bottom to hold across a prepend, set by "load earlier".
   *
   * Measured from the BOTTOM rather than the top so the correction is the same whenever it is
   * applied and applying it twice changes nothing. Prepending a page of forty messages above the
   * reading position pushes it down by their entire height — which is what made loading earlier
   * messages read as jumping somewhere else in the case.
   */
  const holdFromBottomRef = useRef<number | null>(null);

  /**
   * Three columns need real width. From lg up the documents panel is an inline column; below
   * that it lives in a sheet behind a header button. The pinned panel is wider still, so it
   * stays inline only from xl up. JS media queries rather than CSS `hidden lg:flex` so each
   * panel is rendered exactly once — its state (search, selection, loaded PDF) lives in this
   * component either way.
   */
  const docsInline = useMediaQuery("(min-width: 1024px)");
  const pinsInline = useMediaQuery("(min-width: 1280px)");
  /**
   * Whether this device can hover, as against how wide it is.
   *
   * The two were conflated: row actions are revealed on hover and the touch layout was chosen by
   * viewport width, so an iPad in landscape (1024px, no hover) got the desktop rows and their Pin,
   * Open and Retry buttons were unreachable.
   */
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  /** Mirrored, because the scroll handler is not memoised and reads this during a scroll event. */
  const canHoverRef = useRef(canHover);
  canHoverRef.current = canHover;
  /** Below sm the three reasoning dials do not fit one row; they move into a bottom sheet. */
  const compactDials = !useMediaQuery("(min-width: 640px)");
  const [dialsOpen, setDialsOpen] = useState(false);
  /** Below md the header sheds its secondary actions into an overflow menu. */
  const compactHeader = !useMediaQuery("(min-width: 768px)");
  const [docsSheetOpen, setDocsSheetOpen] = useState(false);
  const [pinsSheetOpen, setPinsSheetOpen] = useState(false);

  // Both panels are draggable when they are inline columns. In a sheet there is nothing to size.
  const docs = usePanelWidth(
    "lex_docs_panel_width",
    DOCS_WIDTH.default,
    DOCS_WIDTH.min,
    DOCS_WIDTH.max
  );
  const pins = usePanelWidth(
    "lex_pins_panel_width",
    PINS_WIDTH.default,
    PINS_WIDTH.min,
    PINS_WIDTH.max
  );

  const rowRef = useRef<HTMLDivElement>(null);
  /**
   * Width of the three-column row, rounded to 16px.
   *
   * Read only to cap a drag so the conversation cannot be squeezed to nothing. Rounded because it
   * lands in state: an exact ResizeObserver value would re-render this component on every frame of
   * a window resize.
   */
  // Seeded from the window rather than 0. At 0 the caps returned each panel's static maximum, so
  // for the first frame two stored-wide panels could squeeze the conversation to nothing before the
  // observer fired.
  const [rowWidth, setRowWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth
  );
  useEffect(() => {
    const node = rowRef.current;
    // Absent in jsdom, so a test that mounts this component does not need a stub to get this far.
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width / 16) * 16;
      setRowWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
   * Documents for display: filtered by the search box, most recently ADDED first, each primary
   * carrying the duplicates that point at it so both copies show on one line.
   *
   * Ordered by upload time, not by the date extracted from the document. This panel exists to
   * feed the conversation, and the pièce you are about to ask about is nearly always the one you
   * just put in — on a phone that is the whole interaction. Sorting by the document's own date
   * buried a file just uploaded somewhere in the middle of sixty-eight others, which on a 320px
   * sheet meant scrolling to find a file added ten seconds earlier.
   *
   * The timeline reading of the same case file (oldest-first, by extracted date) is what the
   * story and documents pages are for; it is not what this panel is for.
   */
  const docGroups = useMemo(() => {
    // The shared matcher, not a fourth copy of the same five lines. What "@avenant" offers in the
    // composer has to be what this search box shows for "avenant".
    const matches = (d: LexDocument) => matchesDocumentQuery(d, docQuery);

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
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((primary) => ({
        primary,
        duplicates: dupesByPrimary.get(primary.id) ?? []
      }));
  }, [documents, showProblems, docQuery]);

  /**
   * The '@' mention being typed in the composer.
   *
   * State rather than something derived in render, because it depends on the CARET, which is not
   * part of `input`. Arrow keys and a click move it without changing a character.
   */
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  /**
   * What the '@' menu offers: ready documents, newest added first, same search rule as the panel.
   *
   * Only `ready`. A pin on a document that is still parsing resolves to no pages and no chunks in
   * the backend's retrievePinned, so mentioning one would attach nothing without saying so. The
   * document rows hide their "add to chat" button on non-ready rows for the same reason. Duplicates
   * are excluded because retrieval skips them.
   */
  const mentionCandidates = useMemo(() => {
    if (!mention) return [];
    const needle = mention.query.trim().toLowerCase();
    // A SINGLE word gets the full search (filename, date, tags, key names), the same rule as the
    // panel's search box. A query with whitespace matches the filename alone.
    //
    // This breaks that symmetry on purpose. matchesDocumentQuery also matches timelineDate, so an
    // abandoned '@' mid-sentence ("… voir @voir 2019 …") matched every 2019 document, opened the
    // menu over a finished question, and turned the next Enter into a file pick instead of a send.
    // A multi-word prose fragment can no longer collide with a tag or a date.
    const multiWord = /\s/.test(needle);
    return documents
      .filter((d) => d.parseStatus === "ready" && !d.duplicateOf)
      .filter((d) =>
        multiWord
          ? d.filename.toLowerCase().includes(needle)
          : matchesDocumentQuery(d, needle)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [documents, mention]);

  const mentionMatches = useMemo(
    () => mentionCandidates.slice(0, MENTION_LIMIT),
    [mentionCandidates]
  );

  /**
   * Matching files still being ingested. Counted so their absence from the list is explained: a
   * user who uploads and immediately types '@' would otherwise read an empty menu as a lost file.
   */
  const mentionPending = useMemo(() => {
    if (!mention) return 0;
    // needs_ocr is in neither IN_PROGRESS nor ready, so a document waiting on OCR shows up in
    // neither the list nor this counter. It is a PROBLEM_STATUS row and the panel hides it too.
    return documents.filter(
      (d) =>
        IN_PROGRESS.has(d.parseStatus) &&
        !d.duplicateOf &&
        matchesDocumentQuery(d, mention.query)
    ).length;
  }, [documents, mention]);

  const mentionOpen =
    mention !== null && (mentionMatches.length > 0 || mentionPending > 0);
  /** Clamped, because an upload finishing mid-typing can shorten the list under the cursor. */
  const mentionActive = Math.min(
    mentionIndex,
    Math.max(0, mentionMatches.length - 1)
  );

  /**
   * The pièces that can actually feed a draft, oldest first.
   *
   * Only `ready` documents: anything still parsing has no chunks, and a failed one has none it will
   * ever get. Offering them would let her tick a pièce that silently contributes nothing — the
   * exact failure this dialog exists to end. Duplicates are excluded from retrieval anyway.
   */
  const generatableDocs = useMemo(
    () =>
      documents
        .filter((d) => d.parseStatus === "ready" && !d.duplicateOf)
        .sort((a, b) => {
          if (!a.timelineDate && !b.timelineDate)
            return a.filename.localeCompare(b.filename);
          if (!a.timelineDate) return 1;
          if (!b.timelineDate) return -1;
          return a.timelineDate.localeCompare(b.timelineDate);
        }),
    [documents]
  );

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  /**
   * The same value as activeConvId, readable synchronously. ensureConversation writes both, and the
   * ref is what makes three concurrent callers agree on one conversation instead of creating three.
   */
  const convIdRef = useRef<string | null>(null);
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
  /** The composer's DOM node. The '@' menu reads its caret and writes it back after an insertion. */
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Set when the '@' menu was closed on purpose, by a pick or by Escape.
   *
   * After a pick the caret sits just after the inserted "@filename ", which the mention pattern
   * still reads as an open mention (the query allows spaces), so without this the menu reopened on
   * the very next keyup and could not be dismissed. Cleared by the next real keystroke.
   */
  const mentionClosedRef = useRef(false);
  /** Caret to restore after an inserted mention. The composer is controlled, so it lands on commit. */
  const mentionCaretRef = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [pendingUser, setPendingUser] = useState<{
    content: string;
    /** Set when the turn being sent was spoken, so the echo matches the persisted bubble. */
    audio: LexMessageAudio | null;
  } | null>(null);
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
  /** Runs the user has closed. Session-only: reopening the case starts clean. */
  const [dismissedTasks, setDismissedTasks] = useState<string[]>([]);
  /**
   * What the panel shows: runs that are still going. Nothing else.
   *
   * A finished run used to stay until dismissed, on the reasoning that a drafting run vanishing the
   * moment it succeeds leaves the user hunting for what it made. That reasoning was already served
   * elsewhere and better: the run posts its result INTO this conversation as a message carrying
   * `[Ouvrir le document](/lex/artifacts/…)` (postArtifactResult), and `landedResults` below pulls
   * that message in as soon as the run lands. The thread is the durable record — it survives a
   * reload, which the panel never did, because `dismissedTasks` is session state.
   *
   * So the card was a second copy of a link the thread already held, sitting permanently above the
   * conversation and coming back on every reload however often it was closed. Progress panels show
   * progress; when there is none left to show they go away.
   */
  const activeTasks = useMemo(
    () =>
      [...tasks]
        // Dismissal applies to EVERY state, not only the finished ones. It used to be tested inside
        // a `done` branch alone, so closing a card whose store row still read 'running' did nothing
        // at all, and a row that never refreshed left the card stuck on screen with a close button
        // that did not close it. Dismiss is not cancel: there is a separate Cancel button, and the
        // run carries on regardless — this only stops the user having to watch it.
        .filter((task) => !dismissedTasks.includes(task.id))
        .filter((task) => task.status === "queued" || task.status === "running")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [tasks, dismissedTasks]
  );

  /**
   * Pulls a finished run's answer into the thread.
   *
   * A background run posts its result as a message, and nothing was watching for it: the panel went
   * quiet, the answer sat in the database, and the user had to reload the page to find out the
   * ten-minute run had produced anything. Keyed on the ids themselves so it fires once per result
   * rather than on every store write.
   */
  const landedResults = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "done" && t.resultMessageId)
        .map((t) => t.resultMessageId)
        .sort()
        .join(","),
    [tasks]
  );
  /**
   * Loads a page of messages AND the citations that make its [n] markers traceable.
   *
   * Every path into the thread goes through here — first open, "load earlier", a finished run
   * landing, a reply just sent — because a page loaded without its citations renders every
   * reference in it as inert digits, and that is exactly the bug that made an assessment
   * untraceable: the citations only ever arrived on the live SSE stream, so an answer written by a
   * background run had none, and any answer at all lost them on reload.
   */
  const loadMessages = useCallback(
    async (conversationId: string, beforeSeq?: number) => {
      const { hasMore, citations } =
        await controllers.conversations.loadMessages(conversationId, beforeSeq);
      // Merged, not replaced: paging backwards accumulates messages, so it must accumulate their
      // references too.
      setCitationsByMessage((prev) => ({ ...prev, ...citations }));
      return { hasMore };
    },
    [controllers]
  );

  useEffect(() => {
    if (!activeConvId || landedResults.length === 0) return;
    void loadMessages(activeConvId);
  }, [landedResults, activeConvId, loadMessages]);

  useEffect(() => {
    controllers.tasks.loadForWorkspace(id).catch(() => {
      /* the panel simply stays empty */
    });
  }, [controllers, id]);

  /**
   * What KIND of read the next message gets — a property of that message, not a feature behind a
   * dialog: you type the question you would have asked anyway, pick, and send.
   *
   * Exclusive rather than a set of toggles, because the three are not composable and the UI used to
   * imply they were. Both pills could be lit at once, and the send handler then read only the
   * adverse one — deep was silently discarded. It cost nothing, since an adverse run already reads
   * every document; but a control that accepts a combination it does not honour is a control that
   * lies. There is exactly one axis here, so there is exactly one control.
   *
   *   direct   answers from retrieval, streams back in seconds
   *   deep     reads every document in the case file, minutes, runs in the background
   *   adverse  the same full read, turned AGAINST a party so her own counsel sees it coming
   *
   * Adverse is not a phrasing of deep: what she types means something different — WHO IS BEING
   * DEFENDED, not a question. The app never infers whose side it is on.
   */
  const [mode, setMode] = useState<ChatMode>("direct");
  const deepMode = mode === "deep";
  const adverseMode = mode === "adverse";
  const background = mode !== "direct";
  /**
   * How much deliberation to spend. Persisted, because it is a working preference rather than a
   * per-question decision — but per-turn on the wire, so raising it for one filing does not raise it
   * for every follow-up afterwards.
   *
   * TWO preferences, not one. A background run is a different economic decision from a chat turn: it
   * reads the whole file on the tier chosen here, so `thorough` there is the frontier model over
   * every window. Sharing one value would mean either a chat turn quietly costing what a run costs,
   * or a run quietly dropping to what a chat turn costs — and the second is the one that loses
   * findings silently.
   */
  const [chatDepth, setChatDepth] = useLocalStorage<ReasoningDepth>(
    "lex_chat_depth",
    DEFAULT_DEPTH
  );
  const [runDepth, setRunDepth] = useLocalStorage<ReasoningDepth>(
    "lex_run_depth",
    "thorough"
  );
  const depth = background ? runDepth : chatDepth;
  const setDepth = background ? setRunDepth : setChatDepth;

  // Older messages exist beyond the loaded page (a years-long thread is never fetched whole).
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const handleLoadOlder = async () => {
    if (loadingOlder || messages.length === 0 || !activeConvId) return;
    setLoadingOlder(true);
    try {
      const { hasMore } = await loadMessages(activeConvId, messages[0].seq);
      // Measured after the fetch and before React commits the prepend: this microtask runs before
      // the scheduler task that renders the store write, so scrollHeight here is still the old one.
      const el = scrollRef.current;
      if (el) holdFromBottomRef.current = el.scrollHeight - el.scrollTop;
      setHasOlder(hasMore);
    } catch (err) {
      holdFromBottomRef.current = null;
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setLoadingOlder(false);
    }
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    holdFromBottomRef.current = null;
    atBottomRef.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleThreadScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
    atBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
    // Lazy load upwards. The button below says the same thing out loud, for anyone who does not
    // discover it by scrolling; either way the reading position is held by holdFromBottomRef.
    if (near) return;
    // Auto-load on approach only with a mouse. On a touch screen iOS is still animating the flick
    // when the correction writes scrollTop, so the write either loses or kills the momentum, and
    // the reader lands somewhere unrelated in the case. The sticky "load earlier" button above the
    // thread does the same job on a deliberate tap.
    if (
      canHoverRef.current &&
      el.scrollTop <= TOP_TRIGGER &&
      hasOlder &&
      !loadingOlder
    )
      void handleLoadOlder();
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
      toast({ title: errorMessage(err), variant: "destructive" });
    }
  };

  /**
   * A recording that has been transcribed but not sent. Its transcript is in the composer where it
   * can be corrected; this is the audio it came from, which travels with the message so the bubble
   * can be played back.
   */
  const [voiceDraft, setVoiceDraft] = useState<{
    audioId: string;
    durationSeconds: number;
  } | null>(null);
  /** The recorded file, held so a failed upload or transcription is a retry, not a lost dictation. */
  const [heldRecording, setHeldRecording] = useState<{
    file: File;
    durationSeconds: number;
    /** Send as soon as the transcript arrives, rather than putting it in the composer. */
    autoSend: boolean;
  } | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  /** Set while a recording is being uploaded and transcribed, so the retry cannot double-fire. */
  const transcribingRef = useRef(false);

  // Voice notes: dictate into the chat, then open one to re-listen / correct its transcript.
  const recorder = useVoiceRecorder({
    // The 30-minute cap used to stop the recorder and silently throw the audio away. Now the
    // capped recording flows into the same transcribe path as a manual stop.
    onAutoStop: (file) => {
      if (file) {
        setHeldRecording({
          file,
          durationSeconds: MAX_RECORDING_SECONDS,
          autoSend: false
        });
      }
    }
  });
  const [openVoiceNote, setOpenVoiceNote] = useState<LexDocument | null>(null);
  // The document open in the modal viewer — a one-off look.
  const [openDoc, setOpenDoc] = useState<LexDocument | null>(null);
  /**
   * The reference being traced: which page to open at, and the quote being checked.
   *
   * Separate from `openDoc` because it is a different intent. Opening a pièce from the list is
   * "let me read this"; following a [n] is "show me the passage this sentence rests on", and it
   * must land on the page rather than at the top of a 200-page filing.
   */
  const [tracing, setTracing] = useState<LexCitationEvent | null>(null);
  // Documents held open as tabs in the right-hand panel, and which tab is showing.
  const [pinnedDocs, setPinnedDocs] = useState<LexDocument[]>([]);
  const [activePinnedId, setActivePinnedId] = useState<string | null>(null);

  /**
   * How wide a panel may be dragged right now: its own maximum, minus what the other inline panel
   * and the conversation's floor already claim.
   *
   * Each cap reads the other panel's STORED width rather than its capped one, so the two are not
   * defined in terms of each other. When both stored widths exceed what a narrow window allows the
   * caps are slightly generous, and the Math.max floor means the conversation absorbs the
   * difference rather than a panel dropping below its minimum.
   */
  const pinsMounted = pinsInline && pinnedDocs.length > 0;
  /**
   * What the flex row spends on gaps and rules, computed from what is actually mounted rather than
   * assumed. A constant was wrong in both directions: each rule is a fifth flex child, so mounting
   * two of them takes the row from two gaps to four.
   */
  const rowGutter =
    ROW_GAP * ((docsInline ? 1 : 0) + (pinsMounted ? 1 : 0)) * 2 +
    RULE_WIDTH * ((docsInline ? 1 : 0) + (pinsMounted ? 1 : 0));

  const capWidth = (bounds: { min: number; max: number }, otherWidth: number) =>
    Math.max(
      bounds.min,
      Math.min(bounds.max, rowWidth - CHAT_MIN_WIDTH - otherWidth - rowGutter)
    );

  const docsMax = capWidth(DOCS_WIDTH, pinsMounted ? pins.width : 0);
  const pinsMax = capWidth(PINS_WIDTH, docsInline ? docs.width : 0);
  const docsWidth = Math.min(docs.width, docsMax);
  const pinsWidth = Math.min(pins.width, pinsMax);

  /**
   * Which pièces a background run reads. "all" is the historical behaviour and stays the default:
   * a scope that silently narrowed itself would be the worst possible failure here, since an
   * assessment that read two documents reads exactly like one that read forty-seven.
   *
   * "selected" means the pièces pinned open plus the ones referenced in this message — the two
   * things already on screen when the question is being written. A full read is minutes and real
   * money per document, so asking about two pièces should not read the whole file.
   */
  const [runScope, setRunScope] = useState<"all" | "selected">("all");

  // Generate-artifact dialog state.
  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState<LexArtifactType>("memo");
  const [genTitle, setGenTitle] = useState("");
  const [genInstructions, setGenInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  /**
   * Which pièces the drafter may use. Empty means the whole case file.
   *
   * The dialog used to say nothing about its inputs, and the default was a similarity sample of
   * twelve spans out of twelve thousand — a court document written from 0.09% of the file, with
   * nothing on screen admitting it. Both the scope and the reading mode are now shown before the
   * run and recorded on the version afterwards.
   */
  const [genDocIds, setGenDocIds] = useState<string[]>([]);
  const [genSourceMode, setGenSourceMode] = useState<"search" | "full">(
    "search"
  );
  const [genDocQuery, setGenDocQuery] = useState("");

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
        const { hasMore } = await loadMessages(active.id);
        if (!cancelled) setHasOlder(hasMore);
      } catch (err) {
        if (!cancelled)
          toast({ title: errorMessage(err), variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, controllers, loadMessages, toast]);

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

  /**
   * Keeps the thread where the reader left it.
   *
   * Three cases, in order: an older page just landed (put the held distance from the bottom back),
   * the reader is parked at the end (follow the new content down), or the reader is somewhere above
   * (leave it alone — the jump-to-latest button is how they come back).
   *
   * A layout effect, not an effect: the correction is applied in the same commit as the messages
   * that caused it, so nothing is painted at the wrong offset first.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hold = holdFromBottomRef.current;
    if (hold !== null) {
      holdFromBottomRef.current = null;
      el.scrollTop = el.scrollHeight - hold;
      return;
    }
    if (!atBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight });
    // throttledStreamText, not streamText. streamText changes per TOKEN while the DOM being
    // measured only repaints on the throttled value, so this forced a layout dozens of times a
    // second for nothing. It was the main source of jank during a reply on a phone.
  }, [messages, throttledStreamText, pendingUser, loadingOlder]);

  /**
   * Grows the composer with what is typed.
   *
   * The shared Textarea asks for this with `field-sizing-content`, which is a Tailwind v4 utility
   * that this app's v3 build never emits, so the box stayed a fixed 40px: typing a four-line legal
   * question happened inside a one-line scrolling slot, and iOS Safari draws no resize handle to
   * drag. `resize-y` was a desktop-only escape hatch.
   *
   * Keyed on `recorder.isRecording` as well as on the text, because the Textarea only mounts in the
   * composing branch: after a recording it remounts with no inline height, and `input` alone has not
   * changed, so the effect would not re-run and the box would be one line again.
   */
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    // Writing height:auto forces a reflow, so skip it when the box is already the right size. This
    // runs on every keystroke.
    const target = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT);
    if (el.clientHeight === target && el.scrollHeight <= COMPOSER_MAX_HEIGHT) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [input, recorder.isRecording]);

  /**
   * Re-sticks the thread when the shell shrinks.
   *
   * The keyboard opening changes the shell's height (see use-app-height), which moves the thread's
   * bottom. If that is where the reader was, follow it; otherwise leave them where they are.
   */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (atBottomRef.current) scrollToBottom("auto");
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  /**
   * Files (or a whole folder) go straight to S3. Nothing is silently dropped: rejects and
   * failures are reported, and the folder path is folded into each filename so a flattened
   * document is still identifiable in the timeline and in citations.
   */
  /** Distinct pièces a "selected" run would read: pinned tabs plus this message's references. */
  const selectedScopeCount = useMemo(
    () =>
      new Set([
        ...pinnedDocs.map((d) => d.id),
        ...refs.map((r) => r.documentId)
      ]).size,
    [pinnedDocs, refs]
  );

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
      toast({ title: errorMessage(err), variant: "destructive" });
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
    // The composer is replaced by the recording bar, so an open '@' menu would hang above nothing.
    closeMention();
    try {
      await recorder.start();
    } catch {
      // Almost always a denied/absent microphone.
      toast({ title: t.lex.micDenied, variant: "destructive" });
    }
  };

  /**
   * Holds a document open as a tab in the right-hand panel, and focuses it. Pinning is about
   * keeping a document to hand; the pages sent to the chat come from that panel.
   */
  const pinDocument = useCallback(
    (doc: LexDocument) => {
      setPinnedDocs((prev) =>
        prev.some((d) => d.id === doc.id) ? prev : [...prev, doc]
      );
      setActivePinnedId(doc.id);
      // When the pinned panel lives in a sheet, pinning is the intent to look at it — open it,
      // and get the documents sheet out of the way if that is where the pin was tapped.
      if (!pinsInline) {
        setDocsSheetOpen(false);
        setPinsSheetOpen(true);
      }
    },
    [pinsInline]
  );

  const unpinDocument = useCallback((documentId: string) => {
    setPinnedDocs((prev) => prev.filter((d) => d.id !== documentId));
    setActivePinnedId((prev) => (prev === documentId ? null : prev));
  }, []);

  // Unpinning the last document (or deleting pinned ones) must not leave an empty sheet open.
  useEffect(() => {
    if (pinnedDocs.length === 0) setPinsSheetOpen(false);
  }, [pinnedDocs.length]);

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

  /**
   * One tap: attach the whole document to the next question, no viewer, no page picking. Tapping
   * again detaches it, so the control states what it did and is its own undo.
   *
   * It used to close the documents sheet, on the reasoning that the reference chip lands above the
   * composer where the sheet was covering it. But attaching pièces is not a one-shot action — a
   * question is usually about two or three of them — and closing meant reopening the sheet, finding
   * your place in it, and tapping again for every one after the first. The sheet now stays open,
   * says which rows are attached, and carries a footer with the count and the way back to the
   * composer.
   */
  const referenceWholeDocument = useCallback((doc: LexDocument) => {
    setRefs((prev) =>
      prev.some((r) => r.documentId === doc.id)
        ? prev.filter((r) => r.documentId !== doc.id)
        : [...prev, { documentId: doc.id, filename: doc.filename, pages: [] }]
    );
  }, []);

  // ── '@' file mention ──────────────────────────────────────────────────────────────────

  /** Re-reads the caret and opens or closes the '@' menu. Called from anything that can move it. */
  const syncMention = useCallback((el: HTMLTextAreaElement) => {
    if (mentionClosedRef.current) {
      setMention(null);
      return;
    }
    setMention(findMention(el.value, el.selectionStart ?? el.value.length));
  }, []);

  const closeMention = useCallback(() => {
    mentionClosedRef.current = true;
    setMention(null);
  }, []);

  /**
   * Inserts the picked file as an "@filename" token and attaches it as a reference.
   *
   * The token stays in the sentence, because that is how the question reads ("compare @A with @B")
   * and removing it would leave "compare  with ". The reference is what the server actually
   * receives. A document that already carries pinned pages keeps them: the mention says which
   * pièce, the viewer said which pages, and widening it back to the whole file would throw the page
   * choice away.
   */
  const pickMention = useCallback(
    (doc: LexDocument) => {
      // The caret is read from the DOM, not from the `mention` state.
      //
      // Splicing state-captured indices into whatever the value is at commit time corrupts the text
      // if anything changed between that render and the pick, and writing the caret ref inside a
      // state updater runs during the render phase, which StrictMode double-invokes. The menu's
      // pointerdown prevents its default, so the composer keeps focus and its selection: reading
      // the live node is valid for a mouse pick as well as a keyboard one.
      const el = composerRef.current;
      if (!el) return;
      const current = findMention(
        el.value,
        el.selectionStart ?? el.value.length
      );
      if (!current) return;
      const next = applyMention(el.value, current, doc.filename);
      mentionCaretRef.current = next.caret;
      setInput(next.text);
      setRefs((prev) =>
        prev.some((r) => r.documentId === doc.id)
          ? prev
          : [...prev, { documentId: doc.id, filename: doc.filename, pages: [] }]
      );
      setMentionIndex(0);
      closeMention();
    },
    [closeMention]
  );

  // A new query starts at the top of the list.
  useEffect(() => setMentionIndex(0), [mention?.query]);

  /**
   * Restores the caret after an inserted mention.
   *
   * A layout effect because the composer is controlled: the caret can only be placed once React has
   * committed the new value, and doing it in a plain effect would let the browser paint with the
   * caret at the end of the box first.
   */
  useLayoutEffect(() => {
    const el = composerRef.current;
    const caret = mentionCaretRef.current;
    if (!el || caret === null) return;
    mentionCaretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [input]);

  const handleRetryDoc = useCallback(
    async (docId: string) => {
      try {
        await controllers.documents.retry(docId);
      } catch (err) {
        toast({ title: errorMessage(err), variant: "destructive" });
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
      toast({ title: errorMessage(err), variant: "destructive" });
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
      toast({ title: errorMessage(err), variant: "destructive" });
    }
  };

  const removeRef = (documentId: string) =>
    setRefs((prev) => prev.filter((r) => r.documentId !== documentId));

  /**
   * The pins are also named in the message text. Not for the model's benefit — it receives them
   * structurally — but so the persisted conversation still shows what was being looked at when
   * the question was asked, months later.
   *
   * A pin the sentence already names with an "@filename" token is left out of the prefix: it is
   * already in the text, and repeating it made a two-file question read the same names twice. A pin
   * carrying PAGES stays, because the token says which file and not which pages.
   */
  const buildContent = (text: string): string => {
    const unnamed = refs.filter(
      (r) => r.pages.length > 0 || !textNamesDocument(text, r.filename)
    );
    if (unnamed.length === 0) return text;
    const labels = unnamed
      .map(
        (r) =>
          `${r.filename}${r.pages.length ? ` (p.${r.pages.join(", ")})` : ""}`
      )
      .join("; ");
    return `[${t.lex.referencesLabel}: ${labels}]\n\n${text}`;
  };

  /**
   * The conversation this workspace's chat belongs to, created on first use.
   *
   * Read through a ref rather than the state, because three paths reach it — sending, recording and
   * generating a document — and setState has not committed by the time a second one runs. That race
   * created two conversations and filed the question in the empty one.
   *
   * The title is optional: a recording arrives before there is any text to derive one from, and
   * streamReply's COALESCE names the thread on the first reply.
   */
  // Kept in step with every other writer of activeConvId (switching threads, loading the newest).
  useEffect(() => {
    convIdRef.current = activeConvId;
  }, [activeConvId]);

  const ensureConversation = useCallback(
    async (title?: string): Promise<string> => {
      if (convIdRef.current) return convIdRef.current;
      const conversation = await controllers.conversations.create(id, title);
      convIdRef.current = conversation.id;
      setActiveConvId(conversation.id);
      return conversation.id;
    },
    [controllers, id]
  );

  /**
   * Sends the composer's question, or an override when the caller already has the text.
   *
   * The override exists for the spoken path: `setInput` then `handleSend()` would read the old
   * state, because React has not committed by the time the next line runs.
   */
  const handleSend = async (override?: {
    text: string;
    audioId: string;
    durationSeconds: number;
  }) => {
    const text = override ? override.text.trim() : input.trim();
    // The guard MUST be a ref, not the `streaming` state. React state updates are batched, so a
    // held-down or double-tapped Enter fires several keydowns within one tick, every one of them
    // seeing streaming===false and the pre-cleared `input` — which sent the same message three
    // and six times over in real use.
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    // Or a stale query stays parsed against a box that is now empty.
    closeMention();
    // Sending is an implicit "take me to the end": the reply belongs at the bottom and the user
    // just asked for it. Without this, a question typed while scrolled up streams off-screen.
    atBottomRef.current = true;
    setAtBottom(true);

    let convId: string;
    try {
      convId = await ensureConversation(text.slice(0, 60));
    } catch (err) {
      // Release the guard, or the composer stays locked for the rest of the session.
      sendingRef.current = false;
      toast({ title: errorMessage(err), variant: "destructive" });
      return;
    }

    const content = buildContent(text);

    // Deep mode: hand the question to the background runner instead of streaming a reply. It
    // reads every document in the case file, so it takes minutes — the TaskPanel above the thread
    // shows its progress and reasoning, and the answer is posted here when it lands.
    if (deepMode || adverseMode) {
      // Pinned tabs plus this message's references, de-duplicated: both are "the pièce I am
      // asking about", and which one the user reached for should not change what gets read.
      const scopedIds =
        runScope === "selected"
          ? Array.from(
              new Set([
                ...pinnedDocs.map((d) => d.id),
                ...refs.map((r) => r.documentId)
              ])
            )
          : [];
      // Launching a scoped run with an empty scope would read the whole file, which is the
      // opposite of what the toggle says. Refuse instead, and keep the question in the box.
      if (runScope === "selected" && scopedIds.length === 0) {
        setInput(text);
        toast({ title: t.lex.scopeEmpty, variant: "destructive" });
        sendingRef.current = false;
        return;
      }
      // A background run writes its own synthetic user turn, so there is no bubble here for a
      // recording to hang off. The transcript is already the brief; release the audio and its
      // object rather than leaving a draft nothing can reach.
      const strandedAudioId = override?.audioId ?? voiceDraft?.audioId;
      if (strandedAudioId) {
        setVoiceDraft(null);
        void api.lex.voice.discard(strandedAudioId).catch(() => undefined);
      }
      try {
        await controllers.tasks.create({
          workspaceId: id,
          conversationId: convId,
          kind: adverseMode ? "adverse_case" : "assess_documents",
          // Absent means the whole case file, so an unscoped run is unchanged.
          params: scopedIds.length > 0 ? { documentIds: scopedIds } : undefined,
          // For an assessment the first line labels the task and the whole text is the brief. For
          // an adverse read the text IS the party being defended, which the runner reads from the
          // title — hence no truncation-by-line there.
          // The @ tokens come OUT of the title. The backend consumes it verbatim, and in adverse
          // mode the title IS the party being defended ("PARTY BEING DEFENDED: ${title}"), so a
          // leading filename token would have the model build a case against a PDF. In assessment
          // mode the same string labels the task in the panel.
          title: adverseMode
            ? stripMentions(
                text,
                refs.map((r) => r.filename)
              ).slice(0, 200)
            : stripMentions(
                text.split("\n")[0],
                refs.map((r) => r.filename)
              ).slice(0, 200),
          instructions: adverseMode ? undefined : content,
          // Applies to BOTH passes of the run — the per-document read and the synthesis.
          depth: runDepth
        });
        setMode("direct");
      } catch (err) {
        setInput(text); // don't lose a long question because the launch failed
        toast({ title: errorMessage(err), variant: "destructive" });
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
    // Snapshotted with the pins and for the same reason: an in-flight send must be unaffected by
    // what the composer does next.
    const audioId = override?.audioId ?? voiceDraft?.audioId;
    const audioDuration =
      override?.durationSeconds ?? voiceDraft?.durationSeconds;
    const audio: LexMessageAudio | null = audioId
      ? {
          id: audioId,
          contentType: "",
          durationSeconds: audioDuration ?? null,
          createdAt: new Date().toISOString()
        }
      : null;
    setPendingUser({ content, audio });
    setVoiceDraft(null);
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
        { pins, depth, audioId }
      );
      // Pull the persisted user + assistant messages into the store, then drop the local echo.
      await loadMessages(convId);
    } catch (err) {
      // Only a PRE-STREAM rejection means nothing was persisted. A failure inside the stream
      // happens after the user turn has committed and its audio has been bound, so putting either
      // back would duplicate the question and re-offer a recording that can no longer be attached.
      if (err instanceof LexStreamRejected) {
        setInput((prev) => (prev.trim() ? prev : text));
        if (audioId && audioDuration !== undefined) {
          setVoiceDraft({ audioId, durationSeconds: audioDuration });
        }
      }
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      sendingRef.current = false;
      setStreaming(false);
      setStreamText("");
      setStreamCitations([]);
      setPendingUser(null);
    }
  };

  /**
   * Uploads a held recording, transcribes it, and either sends it or puts the text in the composer.
   *
   * An explicit callback rather than an effect keyed on `heldRecording`: as an effect it had to set
   * a "transcribing" flag that was itself a dependency, so the commit re-ran the effect, the
   * cleanup cancelled the in-flight request, and the upload plus the transcription were paid for
   * and thrown away. The retry button calls this same function, so the two paths cannot diverge.
   */
  const transcribeRecording = useCallback(
    async (rec: { file: File; durationSeconds: number; autoSend: boolean }) => {
      if (transcribingRef.current) return;
      transcribingRef.current = true;
      setTranscribing(true);
      try {
        const convId = await ensureConversation();
        const result = await uploadVoiceMessage(
          convId,
          rec.file,
          rec.durationSeconds
        );
        const transcript = result.transcript.trim();
        const durationSeconds = result.durationSeconds ?? rec.durationSeconds;
        setHeldRecording(null);

        // An empty transcript is not an error. Silence and a muted mic both land here, and the
        // recording is still worth keeping: attach it and let the message be typed.
        if (!transcript) {
          setVoiceDraft({ audioId: result.audioId, durationSeconds });
          toast({ title: t.lex.voiceNoSpeech });
          return;
        }
        if (rec.autoSend) {
          await handleSend({
            text: transcript,
            audioId: result.audioId,
            durationSeconds
          });
          return;
        }
        setVoiceDraft({ audioId: result.audioId, durationSeconds });
        // Appended, not replaced: whatever was already typed is part of the same question.
        setInput((prev) =>
          prev.trim() ? `${prev.trim()}\n\n${transcript}` : transcript
        );
      } catch (err) {
        // The file stays held, so the bar offers a retry rather than losing the dictation.
        toast({ title: errorMessage(err), variant: "destructive" });
      } finally {
        transcribingRef.current = false;
        setTranscribing(false);
      }
    },
    // handleSend is deliberately absent: it is a plain function redefined each render, it reads
    // everything it needs from state at call time, and listing it would rebuild this callback on
    // every keystroke.
    [ensureConversation, toast, t]
  );

  /**
   * Stops the recording and hands it to the transcribe path.
   *
   * `autoSend` is the asked-for flow: press the mic, speak, press send, and the agent answers.
   * `Review` is the same up to the transcript, which then lands in the composer instead. It exists
   * because speech-to-text mishears proper names and, on a silent clip, invents a whole sentence —
   * and in a case file one extra tap costs less than a message naming the wrong party.
   */
  const handleStopRecording = async (autoSend: boolean) => {
    const durationSeconds = recorder.elapsed;
    const file = await recorder.stop();
    if (!file) {
      // Nothing captured, unless the 30-minute cap already settled it — onAutoStop has that file
      // and is transcribing it, so a "nothing was recorded" toast here would be a lie.
      if (!heldRecording) {
        toast({ title: t.lex.voiceEmpty, variant: "destructive" });
      }
      return;
    }
    if (durationSeconds < MIN_VOICE_SECONDS) {
      toast({ title: t.lex.voiceTooShort, variant: "destructive" });
      return;
    }
    // Checked here as well as server-side, so a long dictation is not uploaded before being told
    // it cannot be transcribed.
    if (file.size > MAX_VOICE_MESSAGE_BYTES) {
      toast({ title: t.lex.voiceTooLarge, variant: "destructive" });
      return;
    }
    const rec = { file, durationSeconds, autoSend };
    // Held for the retry bar, and transcribed straight away. Not via an effect — see
    // transcribeRecording for why that shape lost recordings.
    setHeldRecording(rec);
    void transcribeRecording(rec);
  };

  /**
   * Detaches the recording from the turn being composed.
   *
   * The transcript stays in the composer: it is text the user may still want to send. The object is
   * deleted server-side, because this path is fully under our control and leaving the bytes behind
   * would be a guaranteed leak per use.
   */
  const discardVoiceDraft = useCallback(() => {
    setVoiceDraft((draft) => {
      if (draft)
        void api.lex.voice.discard(draft.audioId).catch(() => undefined);
      return null;
    });
  }, []);

  /**
   * Files a spoken turn as a pièce, so a dictated fact becomes retrievable and citable.
   *
   * useCallback because UserMessage is memoized and this component re-renders on every throttled
   * token of a streaming reply.
   */
  const handleFileVoiceAsDocument = useCallback(
    async (audioId: string) => {
      try {
        await api.lex.voice.fileAsDocument(audioId);
        // Both: the panel needs the new row, and the bubble needs its documentId to stop offering
        // the action.
        await Promise.all([
          controllers.documents.loadForWorkspace(id),
          activeConvId ? loadMessages(activeConvId) : Promise.resolve()
        ]);
        toast({ title: t.lex.filedAsDocument });
      } catch (err) {
        toast({ title: errorMessage(err), variant: "destructive" });
      }
    },
    [controllers, id, activeConvId, loadMessages, toast, t]
  );

  /**
   * Follows a reference to the passage behind it.
   *
   * The pièce is resolved from the loaded documents by id, and a citation whose document is gone
   * (deleted, or superseded as a duplicate) says so instead of opening an empty viewer — an
   * untraceable reference must be reported, not silently ignored.
   */
  /** Opening a pièce to read it, not to check a reference — so any page/quote target is cleared. */
  const handleOpenDoc = useCallback((doc: LexDocument) => {
    setTracing(null);
    setOpenDoc(doc);
  }, []);

  const handleTrace = useCallback(
    (citation: LexCitationEvent) => {
      const target = documents.find((d) => d.id === citation.documentId);
      if (!target) {
        toast({ title: t.lex.sourceUnavailable, variant: "destructive" });
        return;
      }
      setTracing(citation);
      setOpenDoc(target);
    },
    [documents, t, toast]
  );

  const genDocIdSet = useMemo(() => new Set(genDocIds), [genDocIds]);

  const genVisibleDocs = useMemo(() => {
    const needle = genDocQuery.trim().toLowerCase();
    if (needle.length === 0) return generatableDocs;
    return generatableDocs.filter(
      (d) =>
        d.filename.toLowerCase().includes(needle) ||
        (d.timelineDate ?? "").includes(needle)
    );
  }, [generatableDocs, genDocQuery]);

  /**
   * The sentence under the pièce list: how many pièces are in scope, and how many spans of them the
   * drafter will see.
   *
   * Both halves are stated because either alone misleads. "56 pièces" reads as "the whole file was
   * used" when the sampled mode shows the model twelve spans of it; "12 passages" says nothing about
   * what they were drawn from.
   */
  const genScopeLine = useMemo(() => {
    const scope =
      genDocIds.length === 0
        ? t.lex.scopeWholeFile.replace("{n}", String(generatableDocs.length))
        : t.lex.scopeSelection
            .replace("{n}", String(genDocIds.length))
            .replace("{total}", String(generatableDocs.length));
    return `${scope} · ${t.lex.scopePassages.replace(
      "{n}",
      String(ARTIFACT_PACK_SIZE[genSourceMode])
    )}`;
  }, [genDocIds.length, generatableDocs.length, genSourceMode, t]);

  /**
   * Opens the dialog, seeded from whatever is ticked in the documents panel.
   *
   * Ticking pièces and then hitting "generate" is the natural gesture, and having the dialog ignore
   * that selection would be a quiet contradiction of what is on screen.
   */
  const openGenerate = () => {
    setGenDocIds(selectedDocs);
    setGenDocQuery("");
    setGenOpen(true);
  };

  /**
   * Launches the drafting run and closes — it does NOT wait for the document.
   *
   * It used to await the whole thing over one HTTP request: retrieve the pack, draft, then one
   * frontier-model judge per claim, sequentially. That request outlived nginx's default 60s read
   * timeout, whose 504 carries no CORS header, so the browser reported a CORS failure and the real
   * cause was invisible — and nothing was persisted until the end, so the run was simply lost.
   *
   * Now it queues a task: progress appears in the panel above the thread, the finished document is
   * posted into the conversation as a link, and closing the tab no longer kills it.
   */
  const handleGenerate = async () => {
    if (!genTitle.trim() || generating) return;
    setGenerating(true);
    try {
      const convId = await ensureConversation(genTitle.trim());
      await controllers.tasks.create({
        workspaceId: id,
        conversationId: convId,
        kind: "generate_artifact",
        title: genTitle.trim(),
        instructions: genInstructions.trim() || undefined,
        depth: runDepth,
        params: {
          type: genType,
          // Empty means the whole file, which the schema expresses as absent rather than as [].
          documentIds: genDocIds.length > 0 ? genDocIds : undefined,
          sourceMode: genSourceMode
        }
      });
      setGenOpen(false);
      setGenTitle("");
      setGenInstructions("");
      toast({ title: t.lex.generationQueued });
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    // h-full, not calc(100vh-…): the shell's <main> owns the viewport math (padding varies by
    // breakpoint, and mobile adds a top bar), so the page just fills whatever it is given.
    <div className="flex flex-col h-full">
      {/* One header across the full width. The case name lives here rather than in the narrow
          documents column, where it was truncated to a couple of characters. */}
      <header className="flex items-center gap-2 md:gap-3 pb-2 mb-2 md:pb-3 md:mb-3 border-b">
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
              {/* Visible on touch: nothing else hinted that the case name is editable. */}
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity can-hover:opacity-0 can-hover:group-hover/name:opacity-100" />
            </button>
          )}
          <p className="hidden sm:block text-xs text-muted-foreground truncate">
            {t.lex.subtitle}
          </p>
        </div>

        {/* Below md the labels drop and the buttons become icons — every one keeps its title and
            aria-label, so nothing is lost, only ink. */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          {!docsInline ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDocsSheetOpen(true)}
              title={t.lex.documents}
              aria-label={t.lex.documents}
            >
              <FolderOpen className="h-4 w-4" />
              <span className="ml-1 text-xs tabular-nums">
                {docGroups.length}
              </span>
            </Button>
          ) : null}
          {!pinsInline && pinnedDocs.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPinsSheetOpen(true)}
              title={t.lex.pinned}
              aria-label={t.lex.pinned}
            >
              <Pin className="h-4 w-4" />
              <span className="ml-1 text-xs tabular-nums">
                {pinnedDocs.length}
              </span>
            </Button>
          ) : null}
          {/* Below md these fold into one overflow menu. They are the leave-the-chat actions, and
              on a phone they were unlabelled icons competing for the same row as the two buttons
              that reach the panels. From md up the labels render and fit, so nothing changes. */}
          {compactHeader ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  title={t.lex.moreActions}
                  aria-label={t.lex.moreActions}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="h-11"
                  onSelect={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {t.lex.uploadDocument}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-11"
                  onSelect={() => navigate(`/lex/workspaces/${id}/documents`)}
                >
                  <Files className="mr-2 h-4 w-4" />
                  {t.lex.allDocuments}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-11"
                  onSelect={() => navigate(`/lex/workspaces/${id}/story`)}
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  {t.lex.story.tab}
                </DropdownMenuItem>
                {messages.length > 0 ? (
                  <DropdownMenuItem
                    className="h-11"
                    onSelect={() => void handleCopyConversation()}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {t.lex.copyConversation}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/lex/workspaces/${id}/documents`)}
                title={t.lex.allDocuments}
                aria-label={t.lex.allDocuments}
              >
                <Files className="h-4 w-4 md:mr-1.5" />
                <span className="hidden md:inline">{t.lex.allDocuments}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/lex/workspaces/${id}/story`)}
                title={t.lex.story.tab}
                aria-label={t.lex.story.tab}
              >
                <CalendarClock className="h-4 w-4 md:mr-1.5" />
                <span className="hidden md:inline">{t.lex.story.tab}</span>
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
            </>
          )}
          <Button
            size="sm"
            onClick={() => openGenerate()}
            className="gradient-terracotta text-white"
            title={t.lex.newArtifact}
            aria-label={t.lex.newArtifact}
          >
            <Plus className="h-4 w-4 md:mr-1.5" />
            <span className="hidden md:inline">{t.lex.newArtifact}</span>
          </Button>
        </div>
      </header>

      {/* The upload inputs live at the page root, not in the documents panel: the composer's
          paperclip clicks them too, and below lg the panel is a sheet that may not be mounted. */}
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

      <div
        ref={rowRef}
        // The panel widths are CSS variables so a resize rule can drag them without re-rendering
        // this component. React only writes style properties whose value changed between renders,
        // so an unrelated render mid-drag leaves the dragged value in place.
        style={
          {
            "--lex-docs-w": `${docsWidth}px`,
            "--lex-pins-w": `${pinsWidth}px`
          } as CSSProperties
        }
        className="flex flex-1 gap-3 md:gap-4 min-h-0"
      >
        {/* Documents panel */}
        <DocumentsPanelContainer
          inline={docsInline}
          open={docsSheetOpen}
          onOpenChange={setDocsSheetOpen}
          title={t.lex.documents}
          footer={
            refs.length > 0 ? (
              <Button
                className="w-full gradient-terracotta text-white"
                onClick={() => setDocsSheetOpen(false)}
              >
                {t.lex.backToQuestion} ({refs.length})
              </Button>
            ) : null
          }
        >
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

          {/* Search across filename, tags, key names and the timeline date. */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder={t.lex.searchDocuments}
              // text-base below md: under 16px iOS zooms the page on focus and never zooms back.
              className="h-10 pl-8 text-base md:h-8 md:text-xs"
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

          <div className="flex-1 space-y-1.5 overflow-auto overscroll-contain">
            {docGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground px-1">
                {t.lex.noDocuments}
              </p>
            ) : (
              docGroups.map(({ primary, duplicates }, index) => (
                <div key={primary.id} className="rounded-lg border bg-card">
                  {/* A marker where the upload day changes. It used to mark the year on the case
                      timeline, which only read as a chronology while the panel was sorted by the
                      documents' own dates; against an upload order it alternated at random. */}
                  {addedDayOf(primary) !==
                  addedDayOf(docGroups[index - 1]?.primary) ? (
                    <div className="px-2.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                      {formatAddedAt(primary.createdAt)}
                    </div>
                  ) : null}
                  <DocumentRow
                    doc={primary}
                    roomy={!docsInline || !canHover}
                    selected={selectedDocs.includes(primary.id)}
                    onSelect={toggleDocSelected}
                    onOpen={(d) =>
                      isVoiceNote(d) ? setOpenVoiceNote(d) : handleOpenDoc(d)
                    }
                    onPin={pinDocument}
                    isPinned={pinnedDocs.some((p) => p.id === primary.id)}
                    onReference={referenceWholeDocument}
                    isReferenced={refs.some((r) => r.documentId === primary.id)}
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
                        roomy={!docsInline || !canHover}
                        selected={selectedDocs.includes(dupe.id)}
                        onSelect={toggleDocSelected}
                        onOpen={(d) =>
                          isVoiceNote(d)
                            ? setOpenVoiceNote(d)
                            : handleOpenDoc(d)
                        }
                        onPin={pinDocument}
                        isPinned={pinnedDocs.some((p) => p.id === dupe.id)}
                        onReference={referenceWholeDocument}
                        isReferenced={refs.some(
                          (r) => r.documentId === dupe.id
                        )}
                        onRetry={handleRetryDoc}
                      />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </DocumentsPanelContainer>

        {/* Only when the panel is an inline column. In a sheet there is nothing to size. */}
        {docsInline ? (
          <PanelResizer
            side="right"
            cssVar="--lex-docs-w"
            target={rowRef}
            value={docsWidth}
            min={DOCS_WIDTH.min}
            max={docsMax}
            onCommit={docs.commit}
            onReset={docs.reset}
            label={t.lex.resizeDocuments}
            title={t.lex.resizeHint}
          />
        ) : null}

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
                  onClose={() => {
                    setDismissedTasks((prev) => [...prev, task.id]);
                    void controllers.tasks.refresh(task.id);
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Positioning context for the jump-to-latest button: it has to float over the thread,
              not over the composer below it. */}
          <div className="relative flex flex-1 flex-col min-h-0">
            <div
              ref={scrollRef}
              onScroll={handleThreadScroll}
              // overflow-x-hidden, not auto: a bubble that overflows must wrap, never turn the
              // whole conversation into a sideways scroll. overscroll-contain stops the thread
              // bouncing the page when a flick reaches either end.
              className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 md:pr-2"
            >
              {messages.length === 0 && !streaming && !pendingUser ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  {t.lex.askPlaceholder}
                </div>
              ) : null}

              {/* Sticky, so a years-long thread never has to be dragged to its very top to reach
                it — it sits at the top of the viewport wherever the reader is. */}
              {hasOlder ? (
                <div className="sticky top-0 z-10 -mx-1 flex justify-center px-1 py-1">
                  <button
                    type="button"
                    onClick={() => void handleLoadOlder()}
                    disabled={loadingOlder}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground disabled:opacity-60"
                  >
                    {loadingOlder ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ChevronUp className="h-3 w-3" />
                    )}
                    {t.lex.loadEarlier}
                  </button>
                </div>
              ) : null}

              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <UserMessage
                      content={m.content}
                      audio={m.audio}
                      onFileAsDocument={handleFileVoiceAsDocument}
                    />
                  </div>
                ) : (
                  <div key={m.id} className="group flex justify-start">
                    <div className="max-w-[92%] md:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-card border">
                      <MarkdownMessage
                        content={m.content}
                        citations={citationsByMessage[m.id] ?? []}
                        onTrace={handleTrace}
                      />
                      <SourceChips
                        citations={citationsByMessage[m.id] ?? []}
                        onTrace={handleTrace}
                      />
                      {/* Hover-revealed where hover exists; on touch screens it is simply visible. */}
                      {/* Same: iPad portrait is >= md, so md:opacity-0 hid the copy action with
                          nothing able to reveal it. */}
                      <div className="mt-1.5 flex justify-end transition-opacity can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:focus-within:opacity-100">
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
                  <div className="max-w-[90%] md:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-sidebar-primary text-sidebar-primary-foreground">
                    {pendingUser.audio ? (
                      <VoiceMessagePlayer
                        audioId={pendingUser.audio.id}
                        durationSeconds={
                          pendingUser.audio.durationSeconds ?? null
                        }
                        className="mb-2"
                      />
                    ) : null}
                    {pendingUser.content}
                  </div>
                </div>
              ) : null}

              {streaming ? (
                <div className="flex justify-start">
                  <div className="max-w-[92%] md:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-card border">
                    {throttledStreamText ? (
                      <MarkdownMessage
                        content={throttledStreamText}
                        citations={streamCitations}
                        onTrace={handleTrace}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t.lex.thinking}
                      </span>
                    )}
                    <SourceChips
                      citations={streamCitations}
                      onTrace={handleTrace}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Jump to the latest message. Appears only when the thread is scrolled away from its
              end, where the alternative is a flick-scroll through a whole case conversation —
              which is most of the time on a phone. */}
            {!atBottom && (messages.length > 0 || streaming || pendingUser) ? (
              <button
                type="button"
                onClick={() => scrollToBottom()}
                title={t.lex.jumpToLatest}
                aria-label={t.lex.jumpToLatest}
                className="absolute bottom-3 right-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border bg-card/95 text-foreground shadow-lg backdrop-blur transition hover:bg-accent md:h-10 md:w-10"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
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
                  className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-[11px]"
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
                    // 28px on touch: detaching a wrongly attached pièce is a routine correction and
                    // this was the smallest control on the screen.
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-destructive md:h-5 md:w-5"
                  >
                    <X className="h-3.5 w-3.5 md:h-3 md:w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* A recording that is being uploaded and transcribed, or one whose transcription
              failed. A SIBLING above the composer, never in its place: the composer has to stay
              usable while this runs, and a failed transcription must not leave the user with no
              Textarea and no Send button. */}
          {heldRecording ? (
            <div className="mt-2 flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
              {transcribing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="text-sm">{t.lex.transcribing}</span>
                  <span className="text-sm font-mono text-muted-foreground">
                    {formatDuration(heldRecording.durationSeconds)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm text-destructive">
                    {t.lex.transcribeFailed}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => setHeldRecording(null)}
                  >
                    {t.lex.discardRecording}
                  </Button>
                  {/* Retries against the object already in S3 — no second upload, no second
                      transcription bill for the attempt that failed. */}
                  <Button
                    size="sm"
                    onClick={() => void transcribeRecording(heldRecording)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    {t.lex.retry}
                  </Button>
                </>
              )}
            </div>
          ) : null}

          {/* A transcribed recording waiting on the send. Its transcript is in the composer. */}
          {voiceDraft ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] pl-2 pr-1 py-0.5 rounded-full bg-muted">
                <Mic className="h-3 w-3" />
                {t.lex.voiceMessage} ·{" "}
                {formatDuration(voiceDraft.durationSeconds)}
                <button
                  onClick={discardVoiceDraft}
                  aria-label={t.lex.removeVoiceMessage}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t.lex.voiceDraftHint}
              </span>
            </div>
          ) : null}

          {recorder.isRecording ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />
              {/* The word is dropped on the narrowest phones: the pulsing dot and the timer already
                  say it, and Cancel plus Review plus Send have to fit the same row. */}
              <span className="hidden text-sm sm:inline">
                {t.lex.recording}
              </span>
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
              {/* The safety valve. Speech-to-text mishears proper names and invents sentences on
                  silence, and in a case file that is worth one extra tap when the user wants it. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleStopRecording(false)}
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                {t.lex.reviewTranscript}
              </Button>
              {/* The asked-for flow: speak, press send, the agent answers. */}
              <Button
                size="sm"
                onClick={() => void handleStopRecording(true)}
                className="gradient-terracotta text-white"
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {t.lex.sendRecording}
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              {/* One wrapper around the input row, so space-y-1.5 still sees exactly the same
                  children whether the menu is open or not. As a sibling of the input row the menu
                  made the row stop being the first child, which under Tailwind 3's
                  `> :not([hidden]) ~ :not([hidden])` selector gave it a 6px margin-top on open and
                  took it away on close: the composer jumped every time the menu appeared. */}
              <div className="relative">
                {/* The '@' menu, anchored above the input row at full column width rather than to the
                  caret. A textarea exposes no caret coordinates, and the mirror-div trick that
                  fakes them needs the exact font metrics and scroll offset of a box that grows with
                  its content and is user-resizable, which this one is. Above the composer is also
                  where the reference chips already appear, so the list lands where the eye is.
                  z-30 beats the jump-to-latest button's z-20. */}
                {mentionOpen ? (
                  <div className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg">
                    <ul
                      id={MENTION_LIST_ID}
                      role="listbox"
                      aria-label={t.lex.mentionMenuLabel}
                      className="max-h-64 overflow-auto overscroll-contain py-1"
                    >
                      {mentionMatches.map((doc, i) => (
                        <li
                          key={doc.id}
                          id={`${MENTION_LIST_ID}-${i}`}
                          role="option"
                          aria-selected={i === mentionActive}
                          // pointerdown with the default prevented, not click: a tap would blur the
                          // composer first, and the insertion is measured from the caret it holds.
                          onPointerDown={(e) => {
                            e.preventDefault();
                            pickMention(doc);
                          }}
                          onPointerEnter={() => setMentionIndex(i)}
                          className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm md:min-h-9 ${
                            i === mentionActive ? "bg-accent" : ""
                          }`}
                        >
                          {isVoiceNote(doc) ? (
                            <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {doc.filename}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {doc.timelineDate ?? formatAddedAt(doc.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {mentionCandidates.length > mentionMatches.length ||
                    mentionPending > 0 ? (
                      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                        {mentionCandidates.length > mentionMatches.length
                          ? `+${mentionCandidates.length - mentionMatches.length} ${t.lex.mentionMore}`
                          : `${mentionPending} ${t.lex.mentionProcessing}`}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-end gap-2">
                  {/* Multi-line: pasting a draft letter or a passage of a filing is a normal action
                    here, and a single-line input made that unreadable. Enter sends, Shift+Enter
                    inserts a newline. */}
                  <Textarea
                    ref={composerRef}
                    value={input}
                    rows={1}
                    onChange={(e) => {
                      setInput(e.target.value);
                      // A real keystroke revives the menu after a pick or an Escape.
                      mentionClosedRef.current = false;
                      syncMention(e.currentTarget);
                    }}
                    // The caret also moves without the text changing: arrows, a click, a drag.
                    onKeyUp={(e) => syncMention(e.currentTarget)}
                    onClick={(e) => syncMention(e.currentTarget)}
                    onKeyDown={(e) => {
                      // An IME candidate window uses these keys too, and Enter there commits a
                      // character rather than sending anything.
                      if (e.nativeEvent.isComposing) return;
                      // While the menu is open it owns the arrows, Enter, Tab and Escape. Enter must
                      // not send: the user is picking a file, not asking the question yet.
                      if (mentionOpen) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const count = mentionMatches.length;
                          if (count > 0) {
                            setMentionIndex(
                              e.key === "ArrowDown"
                                ? (mentionActive + 1) % count
                                : (mentionActive - 1 + count) % count
                            );
                          }
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          closeMention();
                          return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                          const picked = mentionMatches[mentionActive];
                          if (picked) {
                            e.preventDefault();
                            pickMention(picked);
                            return;
                          }
                          // Nothing to pick — the menu is only saying that matching files are still
                          // being ingested — so fall through and let Enter send.
                        }
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={
                      adverseMode
                        ? t.lex.adversePlaceholder
                        : deepMode
                          ? t.lex.deepPlaceholder
                          : t.lex.askPlaceholder
                    }
                    disabled={streaming}
                    // Only while the menu is open, so the composer is not permanently announced as a
                    // combo box in every other state.
                    role={mentionOpen ? "combobox" : undefined}
                    aria-expanded={mentionOpen || undefined}
                    aria-autocomplete={mentionOpen ? "list" : undefined}
                    aria-controls={mentionOpen ? MENTION_LIST_ID : undefined}
                    aria-activedescendant={
                      mentionOpen && mentionMatches.length > 0
                        ? `${MENTION_LIST_ID}-${mentionActive}`
                        : undefined
                    }
                    // resize-none below md: the handle is meaningless on touch and it fights the
                    // auto-grow. The height is set by the layout effect, see COMPOSER_MAX_HEIGHT.
                    className="min-h-10 max-h-48 resize-none overflow-y-auto md:resize-y"
                  />
                  {/* Same hidden input and same handleUpload as the documents panel: one upload
                    path, no exceptions. It is here as well because the file to be read is usually
                    the thing being asked about, and crossing to the left panel mid-question is
                    where people gave up and pasted the text instead. */}
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={streaming || uploading}
                    title={t.lex.uploadDocument}
                    aria-label={t.lex.uploadDocument}
                    // 44px on touch. Kept below sm rather than dropped: the comment above says why
                    // it is here at all, and the header's overflow menu is a second entry point,
                    // not a replacement for the one beside the question.
                    className="h-11 w-11 shrink-0 md:h-9 md:w-auto"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </Button>
                  {/* Below lg the documents panel is a sheet behind a header icon, so attaching a
                      pièce meant leaving the composer, finding one of several unlabelled buttons,
                      scrolling, and coming back. Attaching pièces is the core gesture here, so it
                      gets a control beside the question. */}
                  {!docsInline ? (
                    <Button
                      variant="outline"
                      onClick={() => setDocsSheetOpen(true)}
                      title={t.lex.addToChat}
                      aria-label={t.lex.addToChat}
                      className="relative h-11 w-11 shrink-0 md:h-9 md:w-auto"
                    >
                      <Quote className="h-4 w-4" />
                      {refs.length > 0 ? (
                        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] tabular-nums text-sidebar-primary-foreground">
                          {refs.length}
                        </span>
                      ) : null}
                    </Button>
                  ) : null}
                  {recorder.isSupported ? (
                    <Button
                      variant="outline"
                      onClick={() => void handleStartRecording()}
                      disabled={streaming || uploading || transcribing}
                      title={t.lex.recordVoiceMessage}
                      aria-label={t.lex.recordVoiceMessage}
                      className="h-11 w-11 shrink-0 md:h-9 md:w-auto"
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void handleSend()}
                    disabled={streaming || !input.trim()}
                    className="h-11 w-11 shrink-0 gradient-terracotta text-white md:h-9 md:w-auto"
                  >
                    {streaming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* From sm up the dials sit in the composer where the question is written. Below
                  that they move into a bottom sheet: three groups of pills do not fit a 366px row,
                  and they were taking three lines out of the little height a phone has. */}
              {compactDials ? (
                <button
                  type="button"
                  onClick={() => setDialsOpen(true)}
                  className="inline-flex h-9 w-full items-center justify-between rounded-full border px-3 text-xs"
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                    {mode === "direct" ? (
                      <Send className="h-3.5 w-3.5 shrink-0" />
                    ) : mode === "deep" ? (
                      <Brain className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="truncate">
                      {t.lex.modeName[mode]} · {t.lex.depthName[depth]}
                      {background ? ` · ${t.lex.scopeName[runScope]}` : ""}
                    </span>
                  </span>
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                <ReasoningDials
                  mode={mode}
                  setMode={setMode}
                  depth={depth}
                  setDepth={setDepth}
                  background={background}
                  runScope={runScope}
                  setRunScope={setRunScope}
                  selectedScopeCount={selectedScopeCount}
                  hint={
                    background ? t.lex.runSummary[depth] : t.lex.modeHint.direct
                  }
                />
              )}

              {/* Desktop-only: below md the summary button above already says the same thing, and
                  the sheet repeats it with room to spare.
                  On an empty composer it gives way to the '@' hint: nothing about '@' is
                  guessable, and on a phone the documents panel is a sheet, so this is the cheap
                  path to a reference. Same slot either way, so nothing moves. */}
              <span className="hidden md:inline text-[11px] text-muted-foreground">
                {input.length === 0 && refs.length === 0
                  ? t.lex.mentionHint
                  : background
                    ? t.lex.runSummary[depth]
                    : t.lex.modeHint.direct}
              </span>
            </div>
          )}
        </div>
        {/* Pinned documents: held open as tabs beside the conversation. Pages ticked here are
            sent to the chat as structured references. Inline only from xl up — below that it is
            a right-hand sheet behind the header's pin button, and sending pages closes it so the
            reference chip it just created is visible above the composer. */}
        {pinsInline ? (
          <>
            {/* No rule when nothing is pinned: PinnedDocumentsPanel renders null there, and a rule
                with no panel behind it is a line floating beside the conversation. */}
            {pinnedDocs.length > 0 ? (
              <PanelResizer
                side="left"
                cssVar="--lex-pins-w"
                target={rowRef}
                value={pinsWidth}
                min={PINS_WIDTH.min}
                max={pinsMax}
                onCommit={pins.commit}
                onReset={pins.reset}
                label={t.lex.resizePinned}
                title={t.lex.resizeHint}
              />
            ) : null}
            <PinnedDocumentsPanel
              className="w-[var(--lex-pins-w,25rem)] shrink-0 border-l"
              // The COMMITTED width, so a scan re-rasterises on release rather than per frame.
              // Minus the scroll container's p-2 (16px) and PdfPage's border-2 (4px).
              pageWidth={pinsWidth - 20}
              docs={pinnedDocs}
              activeId={activePinnedId}
              onActivate={setActivePinnedId}
              onClose={unpinDocument}
              onSendToChat={(doc, pages) =>
                referenceInChat(doc.id, doc.filename, pages)
              }
            />
          </>
        ) : (
          <Sheet open={pinsSheetOpen} onOpenChange={setPinsSheetOpen}>
            <SheetContent
              side="right"
              className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-md"
            >
              <SheetHeader className="border-b px-4 py-3 text-left">
                <SheetTitle className="text-sm">{t.lex.pinned}</SheetTitle>
              </SheetHeader>
              <PinnedDocumentsPanel
                className="min-h-0 w-full flex-1"
                docs={pinnedDocs}
                activeId={activePinnedId}
                onActivate={setActivePinnedId}
                onClose={unpinDocument}
                onSendToChat={(doc, pages) => {
                  referenceInChat(doc.id, doc.filename, pages);
                  setPinsSheetOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* The reasoning dials on a phone. side="bottom" supplies neither a height cap nor padding,
          so both are given here: three stacked groups plus the running sentence in FR will outgrow
          a landscape phone with nothing to scroll. */}
      <Sheet open={dialsOpen} onOpenChange={setDialsOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="px-0 pb-3 pr-10 text-left">
            <SheetTitle className="text-sm">{t.lex.readingOptions}</SheetTitle>
          </SheetHeader>
          <ReasoningDials
            stacked
            mode={mode}
            setMode={setMode}
            depth={depth}
            setDepth={setDepth}
            background={background}
            runScope={runScope}
            setRunScope={setRunScope}
            selectedScopeCount={selectedScopeCount}
            hint={background ? t.lex.runSummary[depth] : t.lex.modeHint.direct}
          />
          <Button
            className="mt-4 h-11 w-full gradient-terracotta text-white"
            onClick={() => setDialsOpen(false)}
          >
            {t.lex.done}
          </Button>
        </SheetContent>
      </Sheet>

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
          initialPage={tracing?.pageFrom ?? null}
          highlight={tracing?.quote ?? null}
          onClose={() => {
            setOpenDoc(null);
            setTracing(null);
          }}
        />
      ) : null}

      {/* Generate artifact dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        {/* DialogContent is a `grid`, whose items default to `min-width: auto` — so one long
            filename in the pièce list stretched the whole column and the rows rendered outside the
            dialog, over the page behind it. `minmax(0,1fr)` on the body row is the fix, and it also
            makes that row the one that scrolls: with 72 pièces the dialog is taller than the
            viewport, and without it the middle of the form was simply clipped. */}
        <DialogContent className="sm:max-w-2xl max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader>
            <DialogTitle>{t.lex.newArtifact}</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4 overflow-y-auto overscroll-contain py-2 pr-1">
            <div className="space-y-2">
              <Label>{t.lex.artifactType}</Label>
              <select
                value={genType}
                onChange={(e) => setGenType(e.target.value as LexArtifactType)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
              >
                <option value="memo">{t.lex.typeMemo}</option>
                <option value="chronology">{t.lex.typeChronology}</option>
                <option value="submission">{t.lex.typeSubmission}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t.lex.artifactTitle}</Label>
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

            {/* What the draft will be written FROM. Stated before the run, recorded after it. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t.lex.sourcePieces}</Label>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setGenDocIds([])}
                    className={
                      genDocIds.length === 0
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }
                  >
                    {t.lex.wholeCaseFile}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setGenDocIds(generatableDocs.map((d) => d.id))
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t.lex.selectAllPieces}
                  </button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{genScopeLine}</p>

              {generatableDocs.length > 8 ? (
                <Input
                  value={genDocQuery}
                  onChange={(e) => setGenDocQuery(e.target.value)}
                  placeholder={t.lex.searchDocuments}
                  // See the documents search: under 16px iOS zooms in on focus and stays there.
                  className="h-10 text-base md:h-8 md:text-xs"
                />
              ) : null}

              <div className="max-h-56 min-w-0 divide-y overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border">
                {genVisibleDocs.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    {t.lex.noDocumentsReady}
                  </p>
                ) : (
                  genVisibleDocs.map((d) => (
                    <label
                      key={d.id}
                      className="flex min-w-0 cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={genDocIdSet.has(d.id)}
                        onChange={(e) =>
                          setGenDocIds((prev) =>
                            e.target.checked
                              ? [...prev, d.id]
                              : prev.filter((x) => x !== d.id)
                          )
                        }
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {d.filename}
                      </span>
                      {d.timelineDate ? (
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {d.timelineDate}
                        </span>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* How much of that selection actually reaches the drafter. */}
            <div className="space-y-2">
              <Label>{t.lex.readingMode}</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(["search", "full"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGenSourceMode(mode)}
                    className={`h-full min-w-0 rounded-md border p-2 text-left text-xs transition-colors ${
                      genSourceMode === mode
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="block font-medium">
                      {mode === "search"
                        ? t.lex.readingSampled
                        : t.lex.readingFull}
                    </span>
                    <span className="block text-muted-foreground">
                      {(mode === "search"
                        ? t.lex.readingSampledHint
                        : t.lex.readingFullHint
                      ).replace("{n}", String(ARTIFACT_PACK_SIZE[mode]))}
                    </span>
                  </button>
                ))}
              </div>
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
