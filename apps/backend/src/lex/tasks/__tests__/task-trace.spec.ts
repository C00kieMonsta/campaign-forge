import {
  REASONING_FLUSH_CHARS,
  TaskTrace,
  type PendingTaskEvent
} from "../task-trace";

/**
 * The batcher is the reason a multi-minute run does not drown lex_task_events in one row per
 * token, and the reason a reconnecting client can replay a trace in the order it happened.
 * Both properties are pure logic, so they are locked down here rather than discovered in prod.
 */

/** Simulates a model stream: the same text, arriving in arbitrary slices. */
function pushStream(
  trace: TaskTrace,
  text: string,
  sliceSize: number
): PendingTaskEvent[] {
  const out: PendingTaskEvent[] = [];
  for (let i = 0; i < text.length; i += sliceSize) {
    out.push(...trace.push("reasoning", text.slice(i, i + sliceSize)));
  }
  return out;
}

const reasoningText = (events: PendingTaskEvent[]): string =>
  events
    .filter((e) => e.kind === "reasoning")
    .map((e) => e.message)
    .join("");

describe("TaskTrace", () => {
  it("buffers reasoning until the flush threshold is crossed", () => {
    const trace = new TaskTrace();

    expect(trace.push("reasoning", "a".repeat(100))).toEqual([]);
    expect(trace.push("reasoning", "b".repeat(100))).toEqual([]);
    expect(trace.pendingChars).toBe(200);
    expect(trace.lastSeq).toBe(0);

    const emitted = trace.push(
      "reasoning",
      "c".repeat(REASONING_FLUSH_CHARS - 200)
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].kind).toBe("reasoning");
    expect(emitted[0].message).toHaveLength(REASONING_FLUSH_CHARS);
    expect(trace.pendingChars).toBe(0);
  });

  it("loses nothing: the emitted reasoning reproduces the stream exactly", () => {
    // Prose with word boundaries, so the whitespace snap is exercised too.
    const text = (
      "Le tribunal a constate que la partie defenderesse " +
      "n'a pas produit les pieces demandees dans le delai imparti. "
    ).repeat(40);

    for (const sliceSize of [1, 3, 17, 500]) {
      const trace = new TaskTrace();
      const events = [...pushStream(trace, text, sliceSize), ...trace.flush()];
      expect(reasoningText(events)).toBe(text);
      // One row per ~400 characters, not one per token.
      expect(events.length).toBeLessThan(text.length / 100);
    }
  });

  it("splits a single oversized push into bounded slices", () => {
    const trace = new TaskTrace();
    const events = trace.push(
      "reasoning",
      "x".repeat(REASONING_FLUSH_CHARS * 3 + 50)
    );

    expect(events).toHaveLength(3);
    for (const e of events)
      expect(e.message.length).toBeLessThanOrEqual(REASONING_FLUSH_CHARS);
    expect(trace.pendingChars).toBe(50);
    expect(reasoningText([...events, ...trace.flush()])).toBe(
      "x".repeat(REASONING_FLUSH_CHARS * 3 + 50)
    );
  });

  it("prefers a whitespace boundary so a replayed trace reads as sentences", () => {
    const trace = new TaskTrace();
    // A space just before the hard cut: the slice should end there, not mid-word.
    const text = `${"a".repeat(REASONING_FLUSH_CHARS - 5)} bcdefghij`;
    const [event] = trace.push("reasoning", text);

    expect(event.message).toBe(`${"a".repeat(REASONING_FLUSH_CHARS - 5)} `);
    expect(trace.pendingChars).toBe("bcdefghij".length);
  });

  it("hard-cuts when the only whitespace is too early to snap to", () => {
    const trace = new TaskTrace();
    // One space near the start, then an unbroken token (a URL, a case reference).
    const text = `a ${"b".repeat(REASONING_FLUSH_CHARS * 2)}`;
    const [event] = trace.push("reasoning", text);

    expect(event.message).toHaveLength(REASONING_FLUSH_CHARS);
    expect(event.message.startsWith("a b")).toBe(true);
  });

  it("flushes pending reasoning BEFORE a boundary event, preserving order", () => {
    const trace = new TaskTrace();
    trace.push("reasoning", "thinking about the summons");

    const events = trace.push("finding", "Dagvaarding.pdf, p.3: served late");

    expect(events.map((e) => [e.seq, e.kind])).toEqual([
      [1, "reasoning"],
      [2, "finding"]
    ]);
    expect(events[0].message).toBe("thinking about the summons");
  });

  it("emits progress, finding, error and done immediately", () => {
    const trace = new TaskTrace();
    for (const kind of ["progress", "finding", "error", "done"] as const) {
      const events = trace.push(kind, `${kind} happened`);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe(kind);
    }
    expect(trace.lastSeq).toBe(4);
  });

  it("ignores an empty boundary event but keeps whitespace-only reasoning", () => {
    const trace = new TaskTrace();

    expect(trace.push("progress", "   ")).toEqual([]);
    expect(trace.lastSeq).toBe(0);

    trace.push("reasoning", "  ");
    const flushed = trace.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].message).toBe("  ");
  });

  it("assigns a strictly monotonic seq across every kind", () => {
    const trace = new TaskTrace();
    const events = [
      ...trace.push("progress", "1/2 — reading A"),
      ...trace.push("reasoning", "x".repeat(REASONING_FLUSH_CHARS)),
      ...trace.push("finding", "A, p.1: something"),
      ...trace.push("reasoning", "tail"),
      ...trace.flush()
    ];

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(trace.lastSeq).toBe(4);
  });

  it("resumes from the last persisted seq so a reclaimed run cannot collide", () => {
    // UNIQUE (task_id, seq): a crash-recovered run that restarted at 1 would abort on insert.
    const trace = new TaskTrace(137);
    const [event] = trace.push("progress", "resuming");

    expect(event.seq).toBe(138);
    expect(trace.lastSeq).toBe(138);
  });

  it("flush is idempotent and empty when nothing is buffered", () => {
    const trace = new TaskTrace();
    trace.push("reasoning", "half a thought");

    expect(trace.flush()).toHaveLength(1);
    expect(trace.flush()).toEqual([]);
    expect(trace.lastSeq).toBe(1);
  });
});
