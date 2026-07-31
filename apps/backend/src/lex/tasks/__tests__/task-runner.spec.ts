import { TaskRunner } from "../task-runner.service";

/**
 * The parts of the reasoning loop that decide whether a citation is trustworthy, exercised
 * without a database or a model: how a quote is anchored to a chunk, how one 300-page exhibit is
 * bounded, and how the synthesis prompt is kept inside its budget.
 *
 * Anchoring is the load-bearing one — a finding whose quote is not in the document must never
 * reach an answer that gets filed in court.
 */

// The helpers under test are pure and touch none of the injected services.
const runner = new TaskRunner(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never
) as unknown as {
  windowsOf(text: string): { parts: string[]; truncated: boolean };
  locate(
    quote: string,
    chunks: { chunkId: string; content: string }[]
  ): { chunkId: string } | null;
  budgetFindings<T>(findings: T[]): T[];
};

const chunk = (chunkId: string, content: string) => ({
  chunkId,
  content,
  charStart: 0,
  charEnd: content.length,
  pageFrom: 1,
  pageTo: 1
});

describe("TaskRunner document windowing", () => {
  it("reads a normal document in a single call", () => {
    const { parts, truncated } = runner.windowsOf("a".repeat(10000));
    expect(parts).toHaveLength(1);
    expect(truncated).toBe(false);
  });

  it("splits a long document into per-call windows without losing text", () => {
    const text = "b".repeat(100000);
    const { parts, truncated } = runner.windowsOf(text);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(text);
    expect(truncated).toBe(false);
  });

  it("caps a 300-page exhibit and reports that it was truncated", () => {
    // 600k characters: without the cap this is either a blown context window or the whole budget
    // of the run. `truncated` is what turns a silent omission into a caveat in the answer.
    const { parts, truncated } = runner.windowsOf("c".repeat(600000));

    expect(parts).toHaveLength(4);
    expect(truncated).toBe(true);
  });

  it("caps every window at the per-call input ceiling", () => {
    for (const part of runner.windowsOf("d".repeat(600000)).parts) {
      expect(part.length).toBeLessThanOrEqual(40000);
    }
  });
});

describe("TaskRunner quote anchoring", () => {
  const chunks = [
    chunk("chunk-a", "The parties met on 3 March 2024 in Brussels."),
    chunk(
      "chunk-b",
      "The   defendant   failed to produce the requested documents in time."
    )
  ];

  it("anchors a finding to the chunk its quote actually came from", () => {
    expect(
      runner.locate("failed to produce the requested", chunks)?.chunkId
    ).toBe("chunk-b");
    expect(runner.locate("met on 3 March 2024", chunks)?.chunkId).toBe(
      "chunk-a"
    );
  });

  it("tolerates re-wrapped whitespace and case, which the model reliably changes", () => {
    expect(
      runner.locate("The defendant failed to produce", chunks)?.chunkId
    ).toBe("chunk-b");
    expect(runner.locate("BRUSSELS", chunks)?.chunkId).toBe("chunk-a");
  });

  it("refuses to anchor a quote that is not in the document", () => {
    // The hallucination gate: no chunk means the finding is dropped, not cited to a guess.
    expect(
      runner.locate("The defendant admitted liability", chunks)
    ).toBeNull();
    expect(runner.locate("", chunks)).toBeNull();
  });
});

describe("TaskRunner synthesis budget", () => {
  // Realistic sizes: a self-contained finding plus the verbatim excerpt behind it.
  const finding = (i: number) => ({
    documentId: `doc-${i}`,
    filename: `exhibit-${i}.pdf`,
    text: "x".repeat(200),
    quote: "y".repeat(250),
    chunk: chunk(`chunk-${i}`, "z")
  });

  it("keeps every finding of a realistic 50-document run", () => {
    // 50 documents x 6 findings, the per-document cap: this must not be silently trimmed.
    const findings = Array.from({ length: 300 }, (_, i) => finding(i));
    expect(runner.budgetFindings(findings)).toHaveLength(300);
  });

  it("trims in document order once the prompt budget is spent", () => {
    const findings = Array.from({ length: 2000 }, (_, i) => finding(i));
    const kept = runner.budgetFindings(findings);

    expect(kept.length).toBeLessThan(2000);
    expect(kept[0]).toBe(findings[0]); // earliest documents survive; the tail is what goes
  });
});
