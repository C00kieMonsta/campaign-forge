// Pure event-batching for a background task's reasoning trace. No DB, no timers, no clock —
// everything here is a function of what was pushed, so the whole flush policy is unit-testable.
//
// WHY it exists: the reduce phase arrives as a token stream. Persisting one row per token would
// be tens of thousands of INSERTs for a single multi-minute run, making lex_task_events the
// bottleneck of the very thing it is meant to record. So reasoning accumulates and is written in
// slices, while the events that carry MEANING (a finding, a progress step, a terminal outcome)
// are never delayed — they flush the pending reasoning first, so the trace replays in the order
// it happened.

import type { LexTaskEventKind } from "@packages/types";

/**
 * Reasoning slice size. ~400 characters is roughly a short paragraph: small enough that a
 * watching client sees the model thinking in near-real-time, large enough that a 10k-character
 * synthesis costs ~25 INSERTs instead of ~2500.
 */
export const REASONING_FLUSH_CHARS = 400;

/**
 * Minimum slice length before a whitespace snap is accepted. Without a floor, a slice ending in
 * a long unbroken token (a URL, a case reference) would be cut down to almost nothing.
 */
const MIN_SNAP_CHARS = Math.floor(REASONING_FLUSH_CHARS / 2);

/** An event ready to persist: seq already assigned, message final. */
export interface PendingTaskEvent {
  seq: number;
  kind: LexTaskEventKind;
  message: string;
}

/**
 * Batches a task's trace into persistable events, assigning the per-task monotonic `seq` that
 * `lex_task_events` is unique on and that a reconnecting client resumes from.
 *
 * Seeded with the last seq already persisted, so a task reclaimed after a crash appends to its
 * existing trace instead of colliding on UNIQUE (task_id, seq).
 */
export class TaskTrace {
  /** Reasoning text pushed but not yet large enough to be worth a row. */
  private buffer = "";
  private seq: number;

  constructor(lastSeq = 0) {
    this.seq = lastSeq;
  }

  /** The highest seq handed out so far — the cursor the caller has persisted up to. */
  get lastSeq(): number {
    return this.seq;
  }

  /** Characters buffered and not yet emitted. Exposed for assertions and logging. */
  get pendingChars(): number {
    return this.buffer.length;
  }

  /**
   * Records one piece of the trace and returns whatever is now ready to persist (often nothing).
   *
   * `reasoning` accumulates. Every other kind is a boundary: it forces the buffered reasoning
   * out FIRST, because the thinking that led to a finding must replay before the finding itself.
   */
  push(kind: LexTaskEventKind, text: string): PendingTaskEvent[] {
    if (kind === "reasoning") {
      this.buffer += text;
      return this.drain(false);
    }
    const out = this.drain(true);
    // A boundary event with nothing to say is noise, not a record; the text is stored as given
    // (never trimmed) so the trace stays a faithful copy of what the runner emitted.
    if (text.trim().length > 0) out.push(this.emit(kind, text));
    return out;
  }

  /** Forces out whatever is buffered. Called at every terminal point of a run. */
  flush(): PendingTaskEvent[] {
    return this.drain(true);
  }

  /**
   * Emits full slices, and — when `all` — the remainder too. The loop matters: a single push can
   * be far larger than one slice (a whole document note, or a stream that arrived in one chunk),
   * and one 50k-character row would defeat both the SSE frame size and the replay's readability.
   */
  private drain(all: boolean): PendingTaskEvent[] {
    const out: PendingTaskEvent[] = [];
    while (this.buffer.length >= REASONING_FLUSH_CHARS) {
      out.push(this.emit("reasoning", this.cut()));
    }
    if (all && this.buffer.length > 0) {
      out.push(this.emit("reasoning", this.buffer));
      this.buffer = "";
    }
    return out;
  }

  /**
   * Takes one slice off the front of the buffer, preferring the last whitespace inside the
   * window so a replayed trace reads as sentences rather than words cut in half. Nothing is
   * dropped: concatenating every emitted reasoning message reproduces every character pushed.
   */
  private cut(): string {
    const window = this.buffer.slice(0, REASONING_FLUSH_CHARS);
    const snap = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
    const at = snap >= MIN_SNAP_CHARS ? snap + 1 : REASONING_FLUSH_CHARS;
    const slice = this.buffer.slice(0, at);
    this.buffer = this.buffer.slice(at);
    return slice;
  }

  private emit(kind: LexTaskEventKind, message: string): PendingTaskEvent {
    this.seq += 1;
    return { seq: this.seq, kind, message };
  }
}
