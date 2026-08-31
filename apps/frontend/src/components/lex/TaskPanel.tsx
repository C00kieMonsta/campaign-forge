import { useEffect, useRef, useState } from "react";
import type { LexTask } from "@packages/types";
import { Button } from "@packages/ui";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { streamLexTask } from "@/lib/taskStream";
import { useLexControllers } from "@/store/LexStoreProvider";

const TERMINAL: ReadonlySet<LexTask["status"]> = new Set([
  "done",
  "failed",
  "cancelled"
]);

interface TraceLine {
  seq: number;
  kind: string;
  message: string;
}

/**
 * A running (or finished) background assessment: progress, and the reasoning trace as it arrives.
 *
 * The trace is replayed from the server on mount, so opening this after the task started — or
 * after a full page reload — shows everything, not just what happened from now on. That is the
 * whole reason the trace is persisted rather than only streamed.
 */
export default function TaskPanel({
  task,
  onClose
}: {
  task: LexTask;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const controllers = useLexControllers();

  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [status, setStatus] = useState<LexTask["status"]>(task.status);
  const [progress, setProgress] = useState({
    done: task.progressDone,
    total: task.progressTotal
  });
  const [step, setStep] = useState<string | null>(task.step ?? null);
  const [expanded, setExpanded] = useState(true);
  const traceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void streamLexTask(
      task.id,
      {
        onEvent: (e) => {
          if (cancelled) return;
          setTrace((prev) =>
            // The stream replays from seq 0, and a remount would otherwise duplicate lines.
            prev.some((l) => l.seq === e.seq)
              ? prev
              : [...prev, { seq: e.seq, kind: e.kind, message: e.message }]
          );
        },
        onStatus: (s) => {
          if (cancelled) return;
          setStatus(s.status);
          setProgress({ done: s.progressDone, total: s.progressTotal });
          setStep(s.step ?? null);
        },
        onClosed: () => {
          // Terminal: pull the row so the store (and the chat) sees the result message id.
          if (!cancelled) void controllers.tasks.refresh(task.id);
        }
      },
      0,
      controller.signal
    ).catch(() => {
      /* aborted on unmount, or a transport error — the row is still polled on close */
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [task.id, controllers]);

  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight });
  }, [trace]);

  const pct =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;
  const running = !TERMINAL.has(status);

  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          // 36px on touch, back to a bare icon from sm up. Five controls sat on one 366px row.
          className="-my-1 -ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground sm:mt-0.5 sm:h-auto sm:w-auto"
          aria-label={expanded ? t.lex.showLess : t.lex.showMore}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <Brain
          className={`h-4 w-4 mt-0.5 shrink-0 ${running ? "text-sidebar-primary" : "text-muted-foreground"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{task.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            {running ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                {step ?? t.lex.thinking}
                {pct !== null ? ` · ${progress.done}/${progress.total}` : ""}
              </span>
            ) : (
              t.lex[
                status === "done"
                  ? "taskDone"
                  : status === "cancelled"
                    ? "taskCancelled"
                    : "taskFailed"
              ]
            )}
          </div>
          {pct !== null && running ? (
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-sidebar-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </div>
        {/* A drafting run offers its document the moment it finishes — the panel's own stream reports
            terminal a beat before the store row does, so this is the handoff between the card and the
            link the run posts into the thread, which is where the document lives from then on. Kept
            for that beat, and for a re-verification launched elsewhere in the workspace: this is the
            only place in the chat that names the document it was checking.

            NOT the durable record. The card unmounts once the row goes terminal (see activeTasks) —
            a permanent copy of this button above the conversation was the thing that would not go
            away, however often it was closed. */}
        {!running && task.resultArtifactId ? (
          <Button
            size="sm"
            className="h-9 shrink-0 sm:h-8"
            onClick={() => navigate(`/lex/artifacts/${task.resultArtifactId}`)}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            {t.lex.openDocument}
          </Button>
        ) : null}
        {running ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0 sm:h-8"
            onClick={() => void controllers.tasks.cancel(task.id)}
          >
            {t.lex.cancel}
          </Button>
        ) : null}
        {/* Available WHILE the run is going, which is the only time it is useful now that a finished
            card clears itself. A multi-minute read the user has seen enough of should be closable
            without stopping it — the two are different intentions, and Cancel above is the other one.
            It used to render only on a terminal card, so once those stopped lingering the button
            would have appeared for the instant between the stream reporting done and the row
            refreshing, and never otherwise. */}
        <button
          onClick={onClose}
          // "Masquer", not "Annuler": this hides the panel. It was labelled with the cancel string,
          // which for a screen reader announced it as a button that would stop the run — the
          // opposite of what it does.
          aria-label={t.lex.dismissTask}
          title={t.lex.dismissTask}
          className="-my-1 -mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground sm:h-auto sm:w-auto"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {expanded && trace.length > 0 ? (
        <div
          ref={traceRef}
          className="mt-2 max-h-48 space-y-1 overflow-auto overscroll-contain rounded-lg bg-muted/50 p-2"
        >
          {trace.map((line) => (
            <p
              key={line.seq}
              className={`text-[11px] leading-snug ${
                line.kind === "error"
                  ? "text-destructive"
                  : line.kind === "finding"
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {line.kind === "finding" ? "• " : ""}
              {line.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
