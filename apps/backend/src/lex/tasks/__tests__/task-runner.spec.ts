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
  {} as never,
  {} as never,
  {} as never
) as unknown as {
  windowsOf(
    text: string,
    budget: number
  ): { parts: string[]; truncated: boolean };
  locate(
    quote: string,
    chunks: { chunkId: string; content: string }[]
  ): { chunkId: string } | null;
  budgetFindings<T>(findings: T[]): T[];
  documentHeader(
    doc: {
      id: string;
      filename: string;
      page_count: number | null;
      timeline_date: Date | string | null;
      language: string | null;
      summary: string | null;
    },
    partIndex: number,
    partCount: number
  ): string;
};

const docRow = (
  over: Partial<Parameters<typeof runner.documentHeader>[0]> = {}
) => ({
  id: "d1",
  filename: "convention-1998.pdf",
  page_count: 12,
  timeline_date: "1998-05-27",
  language: "fr",
  summary: "Convention de partage entre les consorts Pirson.",
  ...over
});

const chunk = (chunkId: string, content: string) => ({
  chunkId,
  content,
  charStart: 0,
  charEnd: content.length,
  pageFrom: 1,
  pageTo: 1
});

/** The run budget, wide enough that these cases are bound by the per-document cap. */
const FULL_BUDGET = 200;

describe("TaskRunner document windowing", () => {
  it("reads a normal document in a single call", () => {
    const { parts, truncated } = runner.windowsOf(
      "a".repeat(10000),
      FULL_BUDGET
    );
    expect(parts).toHaveLength(1);
    expect(truncated).toBe(false);
  });

  it("splits a long document into per-call windows without losing text", () => {
    const text = "b".repeat(100000);
    const { parts, truncated } = runner.windowsOf(text, FULL_BUDGET);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(text);
    expect(truncated).toBe(false);
  });

  it("reads an 80-page filing whole", () => {
    // ~200k characters, the ordinary case: a set of conclusions with its exhibits. The previous
    // 4-window cap cut this at 160k and lost the last quarter.
    const text = "e".repeat(200000);
    const { parts, truncated } = runner.windowsOf(text, FULL_BUDGET);

    expect(parts.join("")).toBe(text);
    expect(truncated).toBe(false);
  });

  it("caps a 300-page exhibit and reports that it was truncated", () => {
    // 600k characters: without the cap this is either a blown context window or the whole budget
    // of the run. `truncated` is what turns a silent omission into a caveat in the answer.
    const { parts, truncated } = runner.windowsOf(
      "c".repeat(600000),
      FULL_BUDGET
    );

    expect(parts).toHaveLength(12);
    expect(truncated).toBe(true);
  });

  it("caps every window at the per-call input ceiling", () => {
    for (const part of runner.windowsOf("d".repeat(600000), FULL_BUDGET)
      .parts) {
      expect(part.length).toBeLessThanOrEqual(40000);
    }
  });

  it("stops at the run budget when it binds before the per-document cap", () => {
    const { parts, truncated } = runner.windowsOf("f".repeat(600000), 3);

    expect(parts).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it("reports a document read on an exhausted budget as truncated, not as read", () => {
    // The caveat is the whole point: a document that got zero windows must still be named as
    // partially covered rather than pass silently as fully read.
    const { parts, truncated } = runner.windowsOf("g".repeat(10000), 0);

    expect(parts).toHaveLength(0);
    expect(truncated).toBe(true);
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

describe("documentHeader", () => {
  it("carries the document's own date, language and page count", () => {
    const header = runner.documentHeader(docRow(), 0, 1);
    expect(header).toContain("convention-1998.pdf");
    expect(header).toContain("1998-05-27");
    expect(header).toContain("fr");
    expect(header).toContain("12 pages");
  });

  it("states what the document is, so a letter is not read as a letter about nothing", () => {
    expect(runner.documentHeader(docRow(), 0, 1)).toContain(
      "WHAT IT IS: Convention de partage entre les consorts Pirson."
    );
  });

  it("names the section only when the document was split", () => {
    expect(runner.documentHeader(docRow(), 0, 1)).not.toContain("section");
    expect(runner.documentHeader(docRow(), 1, 4)).toContain("section 2 of 4");
  });

  it("caps the summary, so one verbose document cannot dominate 200 window prompts", () => {
    const header = runner.documentHeader(
      docRow({ summary: "x".repeat(5000) }),
      0,
      1
    );
    expect(header.length).toBeLessThan(600);
  });

  it("collapses newlines in the summary so the header stays two lines", () => {
    const header = runner.documentHeader(
      docRow({ summary: "first line\n\nsecond line" }),
      0,
      1
    );
    expect(header).toContain("WHAT IT IS: first line second line");
    expect(header.trimEnd().split("\n")).toHaveLength(2);
  });

  it("omits every optional field rather than rendering empty parentheses", () => {
    const header = runner.documentHeader(
      docRow({
        page_count: null,
        timeline_date: null,
        language: null,
        summary: null
      }),
      0,
      1
    );
    expect(header).toBe("DOCUMENT: convention-1998.pdf\n");
  });

  it("reads timeline_date from local parts, never through toISOString", () => {
    // A Postgres `date` arrives as a Date at LOCAL midnight. Under Europe/Brussels toISOString()
    // would report 1958-07-09 for the 10 July marriage contract.
    const header = runner.documentHeader(
      docRow({ timeline_date: new Date(1958, 6, 10) }),
      0,
      1
    );
    expect(header).toContain("1958-07-10");
  });
});
