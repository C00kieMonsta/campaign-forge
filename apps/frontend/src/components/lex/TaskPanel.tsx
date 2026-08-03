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
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
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
        {/* A finished drafting run offers its document right here. The alternative is a line of
            text saying it worked and leaving the user to go and find it. */}
        {!running && task.resultArtifactId ? (
          <Button
            size="sm"
            className="shrink-0"
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
            className="shrink-0"
            onClick={() => void controllers.tasks.cancel(task.id)}
          >
            {t.lex.cancel}
          </Button>
        ) : (
          <button
            onClick={onClose}
            // "Masquer", not "Annuler": this hides a finished run's panel. It was labelled with the
            // cancel string, which for a screen reader announced a close button as one that would
            // stop the run — the opposite of what it does, and there is a real Cancel above for
            // that.
            aria-label={t.lex.dismissTask}
            title={t.lex.dismissTask}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {expanded && trace.length > 0 ? (
        <div
          ref={traceRef}
          className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted/50 p-2 space-y-1"
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
