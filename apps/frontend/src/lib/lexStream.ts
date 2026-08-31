import {
  lexStreamEventSchema,
  type LexCitationEvent,
  type LexPin,
  type ReasoningDepth
} from "@packages/types";

// SSE helper for Lex chat. The shared api.ts client is Promise-only (no streaming), so
// token-by-token responses go through this dedicated helper (fetch + ReadableStream),
// reusing the same Bearer auth + 401 handling.

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "admin_token";

export interface LexStreamHandlers {
  onToken?: (delta: string) => void;
  onCitations?: (citations: LexCitationEvent[]) => void;
  onDone?: (messageId: string) => void;
  onError?: (message: string) => void;
}

export interface LexStreamOptions {
  /** Pinned pages: sent structured so the server can constrain retrieval to them. */
  pins?: LexPin[];
  depth?: ReasoningDepth;
  /** The recording this turn was spoken into. The content is still the text. */
  audioId?: string;
  signal?: AbortSignal;
}

/**
 * Thrown when the request was rejected BEFORE the stream opened.
 *
 * Worth its own type: nothing was written server-side, so the caller can put the question back in
 * the composer and keep its attachments. A failure inside the stream is the opposite — the user
 * turn is already committed — and restoring state there would duplicate it.
 */
export class LexStreamRejected extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LexStreamRejected";
  }
}

/**
 * Streams an assistant reply for a conversation. Resolves when the stream ends; rejects on
 * transport/auth errors.
 *
 * Options rather than positionals: pins, depth, audioId and signal is already four trailing
 * arguments and the call sites were becoming unreadable.
 */
export async function streamLexMessage(
  conversationId: string,
  content: string,
  handlers: LexStreamHandlers,
  opts: LexStreamOptions = {}
): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const res = await fetch(
    `${API_BASE}/admin/lex/conversations/${conversationId}/messages/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      // Only send what is set: an absent depth means "use the default", and spelling that out on
      // every request would make the default a client concern.
      body: JSON.stringify({
        content,
        ...(opts.pins?.length ? { pins: opts.pins } : {}),
        ...(opts.depth ? { depth: opts.depth } : {}),
        ...(opts.audioId ? { audioId: opts.audioId } : {})
      }),
      signal: opts.signal
    }
  );

  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok || !res.body) {
    // The server's own message, when it sent one. A rejected recording id is answered here as a
    // 400 with a sentence the composer can show; without reading the body it surfaced as
    // "Stream failed: 400", which tells the user nothing they can act on.
    let message = `Stream failed: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body?.message === "string" && body.message) {
        message = body.message;
      }
    } catch {
      // Not JSON, or already consumed. The status line is what there is.
    }
    throw new LexStreamRejected(message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; the payload is on a `data:` line.
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

function dispatch(json: string, handlers: LexStreamHandlers): void {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return;
  }
  const parsed = lexStreamEventSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "invalidLexStreamEvent",
        error: parsed.error.message
      })
    );
    return;
  }
  const event = parsed.data;
  switch (event.type) {
    case "token":
      handlers.onToken?.(event.delta);
      break;
    case "citations":
      handlers.onCitations?.(event.citations);
      break;
    case "done":
      handlers.onDone?.(event.messageId);
      break;
    case "error":
      handlers.onError?.(event.message);
      break;
  }
}
