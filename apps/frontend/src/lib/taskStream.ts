import { lexTaskStreamEventSchema } from "@packages/types";
import type { LexTaskStreamEvent } from "@packages/types";

// Watches a background reasoning task. The endpoint replays the task's persisted trace from
// `afterSeq` before following live, so a tab opened long after the task started still sees the
// whole reasoning — which is the point of running these in the background at all.

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "admin_token";

export interface TaskStreamHandlers {
  onEvent?: (event: Extract<LexTaskStreamEvent, { type: "event" }>) => void;
  onStatus?: (status: Extract<LexTaskStreamEvent, { type: "status" }>) => void;
  onClosed?: () => void;
}

/**
 * Streams a task's trace. Resolves when the server closes (the task reached a terminal status).
 * Pass an AbortSignal to stop watching — do it on unmount, or the fetch keeps the connection and
 * the server keeps its polling timer alive.
 */
export async function streamLexTask(
  taskId: string,
  handlers: TaskStreamHandlers,
  afterSeq = 0,
  signal?: AbortSignal
): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const res = await fetch(
    `${API_BASE}/admin/lex/tasks/${taskId}/stream?afterSeq=${afterSeq}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal
    }
  );

  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok || !res.body)
    throw new Error(`Task stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (json) dispatch(json, handlers);
    }
  }
}

function dispatch(json: string, handlers: TaskStreamHandlers): void {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return;
  }
  const parsed = lexTaskStreamEventSchema.safeParse(raw);
  if (!parsed.success) return; // an unrecognised frame is ignored, never fatal
  const event = parsed.data;
  if (event.type === "event") handlers.onEvent?.(event);
  else if (event.type === "status") handlers.onStatus?.(event);
  else handlers.onClosed?.();
}
