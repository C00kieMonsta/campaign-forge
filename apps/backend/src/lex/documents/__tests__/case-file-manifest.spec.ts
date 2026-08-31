import {
  buildManifest,
  stateOf,
  type ManifestDoc
} from "../case-file-manifest";

/**
 * The CASE FILE block, exercised without a database.
 *
 * The load-bearing invariant is that EVERY document reaches the block. The bug this block exists to
 * fix is the model denying it has a file the user can see on screen, and a list that silently stops
 * at document 40 recreates that bug for document 41. So the tests below care much more about
 * completeness than about formatting.
 */

const doc = (over: Partial<ManifestDoc> = {}): ManifestDoc => ({
  id: "d1",
  filename: "convention-partage-1998.pdf",
  contentType: "application/pdf",
  parseStatus: "ready",
  lifecycleState: "active",
  timelineDate: "1998-05-27",
  pageCount: 12,
  durationSeconds: null,
  summary: "Convention de partage entre les consorts Pirson et Delvaux.",
  language: "fr",
  keyNames: ["Pirson", "Delvaux"],
  tags: ["convention", "partage"],
  sourcePath: null,
  duplicateOfFilename: null,
  ...over
});

const many = (
  n: number,
  over: (i: number) => Partial<ManifestDoc> = () => ({})
) =>
  Array.from({ length: n }, (_, i) =>
    doc({
      id: `d${i}`,
      filename: `piece-${String(i).padStart(3, "0")}-requete-introductive.pdf`,
      timelineDate: `20${String(10 + (i % 15)).padStart(2, "0")}-03-0${(i % 9) + 1}`,
      summary: `Summary of document number ${i}, several factual sentences long.`,
      ...over(i)
    })
  );

describe("buildManifest — completeness", () => {
  it("returns null for an empty workspace rather than an empty block", () => {
    expect(buildManifest([], [])).toBeNull();
  });

  it("renders three documents at the richest tier, summaries included", () => {
    const built = buildManifest(many(3))!;
    expect(built.tier).toBe("full");
    expect(built.text).toContain("Summary of document number 0");
    expect(built.text).toContain("Summary of document number 2");
    expect(built.text).toContain("names: Pirson, Delvaux");
  });

  // The invariant, at four sizes. Reducing DETAIL is allowed; dropping a document is not.
  it.each([3, 20, 68, 140])("lists every one of %i documents", (n) => {
    const docs = many(n);
    const built = buildManifest(docs)!;
    expect(built.tier).not.toBe("counts");
    expect(built.listed).toBe(n);
    for (const d of docs) expect(built.text).toContain(d.filename);
  });

  it("still carries summaries for the 68-document case file this app was sized for", () => {
    // The user's ask was "title AND summary of file", so the 68-document case is the one that has
    // to keep its summaries rather than degrade to a bare list.
    const built = buildManifest(many(68))!;
    expect(built.tier).toBe("full");
    expect(built.text).toContain("Summary of document number 67");
  });

  it("names every document up to roughly 500, well past any real case file", () => {
    const built = buildManifest(many(500))!;
    expect(built.tier).toBe("filenames");
    expect(built.text).toContain("piece-499-requete-introductive.pdf");
  });

  it("uses each tier as the workspace grows, rather than jumping to counts", () => {
    const tierAt = (n: number) => buildManifest(many(n))!.tier;
    expect(tierAt(20)).toBe("full");
    expect(tierAt(140)).toBe("index");
    expect(tierAt(280)).toBe("names");
    expect(tierAt(400)).toBe("filenames");
  });

  it("says what a bare filename means at the filenames tier", () => {
    const built = buildManifest(many(400))!;
    expect(built.text).toContain(
      "A name with no state in brackets after it is INDEXED"
    );
  });

  it("annotates only the exceptions at the filenames tier", () => {
    const built = buildManifest(
      many(400, (i) => (i === 5 ? { parseStatus: "failed" as const } : {}))
    )!;
    expect(built.text).toContain("piece-005-requete-introductive.pdf (FAILED)");
    expect(built.text).toContain("piece-006-requete-introductive.pdf;");
  });

  it("never exceeds its token ceiling, at any input size", () => {
    // MANIFEST_MAX_TOKENS x 3.4 chars/token. Asserted on the rendered string, as capDigest does.
    const ceiling = Math.ceil(6000 * 3.4);
    for (const n of [1, 13, 30, 68, 140, 280, 500, 900]) {
      const built = buildManifest(many(n))!;
      expect(built.text.length).toBeLessThanOrEqual(ceiling);
    }
  });

  it("falls back to counts only when no tier can list them, and still refuses to deny a file", () => {
    const built = buildManifest(many(900))!;
    expect(built.tier).toBe("counts");
    expect(built.listed).toBe(0);
    expect(built.total).toBe(900);
    expect(built.text).toContain("TOTAL: 900 document(s)");
    expect(built.text).toContain("never say a document is missing");
  });

  it("is deterministic — the same rows render the same string", () => {
    const docs = many(40);
    expect(buildManifest(docs)!.text).toBe(buildManifest(docs)!.text);
  });

  it("caps one verbose summary, so a single document cannot drop the workspace a tier", () => {
    const withMonster = [
      ...many(5),
      doc({ id: "big", summary: "x".repeat(50_000) })
    ];
    const built = buildManifest(withMonster)!;
    expect(built.tier).toBe("full");
    expect(built.text).not.toContain("x".repeat(500));
  });
});

describe("buildManifest — state words", () => {
  // The reported bug, as a test: a document mid-ingestion must be listed, not omitted.
  it("lists a document still being processed, with its state", () => {
    const built = buildManifest([doc({ parseStatus: "embedding" })])!;
    expect(built.text).toContain("convention-partage-1998.pdf");
    expect(built.text).toContain("PROCESSING");
  });

  it.each([
    ["ready", "INDEXED"],
    ["awaiting_upload", "UPLOADING"],
    ["needs_ocr", "NEEDS_OCR"],
    ["failed", "FAILED"],
    ["parsing", "PROCESSING"],
    ["transcribing", "PROCESSING"],
    ["chunking", "PROCESSING"],
    ["summarizing", "PROCESSING"]
  ])("renders %s as %s", (parseStatus, word) => {
    expect(stateOf(doc({ parseStatus: parseStatus as never }))).toBe(word);
  });

  it("degrades an unknown parse_status to PROCESSING, never to a missing document", () => {
    const built = buildManifest([
      doc({ parseStatus: "some_new_state" as never })
    ])!;
    expect(built.text).toContain("PROCESSING");
    expect(built.text).toContain("convention-partage-1998.pdf");
  });

  it("names the original on a duplicate and repeats no summary", () => {
    const built = buildManifest([
      doc({
        id: "dup",
        filename: "scan-copie.pdf",
        parseStatus: "duplicate",
        lifecycleState: "superseded",
        duplicateOfFilename: "convention-partage-1998.pdf",
        summary: "SHOULD NOT APPEAR"
      })
    ])!;
    expect(built.text).toContain("DUPLICATE of convention-partage-1998.pdf");
    expect(built.text).not.toContain("SHOULD NOT APPEAR");
  });

  it("shows a voice note's duration instead of a page count", () => {
    const built = buildManifest([
      doc({
        filename: "note vocale 2026-03-04.webm",
        contentType: "audio/webm",
        pageCount: null,
        durationSeconds: 252
      })
    ])!;
    expect(built.text).toContain("voice note 4:12");
  });
});

describe("buildManifest — counts and archive", () => {
  it("puts the total first, so it survives whatever else is dropped", () => {
    const built = buildManifest(many(5))!;
    expect(built.text.split("\n\n")[1]).toMatch(/^TOTAL: 5 document\(s\)/);
  });

  it("breaks the total down by state", () => {
    const built = buildManifest([
      doc({ id: "a" }),
      doc({ id: "b", parseStatus: "needs_ocr" }),
      doc({ id: "c", parseStatus: "failed" })
    ])!;
    expect(built.text).toContain("1 indexed");
    expect(built.text).toContain("1 awaiting OCR");
    expect(built.text).toContain("1 unreadable");
  });

  it("states the timeline span and how many documents carry no date", () => {
    const built = buildManifest([
      doc({ id: "a", timelineDate: "1958-07-10" }),
      doc({ id: "b", timelineDate: "2024-11-03" }),
      doc({ id: "c", timelineDate: null })
    ])!;
    expect(built.text).toContain("Timeline: 1958-07-10 → 2024-11-03.");
    expect(built.text).toContain("1 document(s) carry no date.");
  });

  it("renders an undated document as undated rather than omitting it", () => {
    const built = buildManifest([doc({ timelineDate: null })])!;
    expect(built.text).toContain("undated");
  });

  it("groups archived documents, caps the names, and says they were not retrieved", () => {
    const archived = many(20, (i) => ({ filename: `archive-${i}.pdf` })).map(
      (d) => ({ ...d, lifecycleState: "archived" as const })
    );
    const built = buildManifest(many(2), archived)!;
    expect(built.archived).toBe(20);
    expect(built.text).toContain("not retrieved for this turn and not citable");
    expect(built.text).toContain("and 8 more");
  });

  it("counts an archive-only workspace instead of returning null", () => {
    const built = buildManifest(
      [],
      [doc({ lifecycleState: "archived", filename: "lettre-2003.pdf" })]
    )!;
    expect(built.total).toBe(0);
    expect(built.text).toContain("lettre-2003.pdf");
  });
});

describe("buildManifest — citation safety", () => {
  // The court-safety invariant. extractCitedIndexes matches /\[(\d+)\]/g, so a [n] anywhere in this
  // block could resolve against the SOURCES list and anchor a citation to the wrong document.
  // Handles are #n precisely so that cannot happen.
  it.each([3, 30, 68, 140, 900])(
    "writes no [n] marker of its own, at %i documents",
    (n) => {
      const built = buildManifest(
        many(n, (i) => ({ filename: `piece-[${i}]-oddly-named.pdf` })),
        [doc({ lifecycleState: "archived", filename: "archive [7].pdf" })]
      )!;
      // Brackets in a FILENAME are user data and are reproduced verbatim on purpose, so the
      // assertion is on the block minus the filenames the fixture deliberately poisoned.
      const withoutNames = built.text
        .replace(/piece-\[\d+\]-oddly-named\.pdf/g, "")
        .replace(/archive \[7\]\.pdf/g, "");
      expect(withoutNames).not.toMatch(/\[\d+\]/);
    }
  );

  it("says plainly that the block is not citable", () => {
    const built = buildManifest(many(3))!;
    expect(built.text).toContain("NEVER CITE FROM THIS BLOCK");
    expect(built.text).toContain("must never be written as [n]");
  });

  it("tells the model a listed but unretrieved document is not a missing one", () => {
    const built = buildManifest(many(3))!;
    expect(built.text).toContain("the document EXISTS");
    expect(built.text).toContain("not retrieved for this turn");
  });
});

describe("buildManifest — hostile input", () => {
  it("never shortens a filename, however long", () => {
    // An earlier design truncated long names from the middle, which quietly restored the bug: the
    // framing licenses the model to deny a filename that appears nowhere in the list, and a
    // truncated filename does not appear.
    const long = `${"tres-longue-piece-de-procedure-".repeat(6)}final.pdf`;
    const built = buildManifest([doc({ filename: long })])!;
    expect(built.text).toContain(long);
  });

  it("strips control bytes out of filenames and summaries", () => {
    // Three documents of the original 65-file bundle carried NUL bytes.
    const built = buildManifest([
      doc({
        filename: "scan\u0000-1998.pdf",
        summary: "texte\u0007 utile"
      })
    ])!;
    // Newlines and tabs are structural and sanitizeForStorage keeps them by design; everything
    // else in the C0/C1 blocks must be gone. Asserted by code point rather than by a regex
    // literal, so the test itself holds no control characters.
    const structural = new Set(["\n", "\t", "\r"]);
    const controls = [...built.text].filter((ch) => {
      const code = ch.codePointAt(0)!;
      if (structural.has(ch)) return false;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
    expect(controls).toEqual([]);
    expect(built.text).toContain("scan-1998.pdf");
    expect(built.text).toContain("texte utile");
  });

  it("disambiguates two documents sharing a filename by their folder", () => {
    const built = buildManifest([
      doc({
        id: "a",
        filename: "scan.pdf",
        sourcePath: "2019/correspondance/scan.pdf"
      }),
      doc({
        id: "b",
        filename: "scan.pdf",
        sourcePath: "2021/expertise/scan.pdf"
      })
    ])!;
    expect(built.text).toContain("in 2019/correspondance/scan.pdf");
    expect(built.text).toContain("in 2021/expertise/scan.pdf");
  });

  it("leaves a unique filename unadorned", () => {
    const built = buildManifest([
      doc({ filename: "scan.pdf", sourcePath: "2019/correspondance/scan.pdf" })
    ])!;
    expect(built.text).not.toContain("in 2019/correspondance");
  });

  it("renders the header line alone when the summariser found nothing", () => {
    const built = buildManifest([
      doc({ summary: null, keyNames: [], tags: [] })
    ])!;
    const lines = built.text.split("\n").filter((l) => l.startsWith("#1 |"));
    expect(lines).toHaveLength(1);
    expect(built.text).not.toMatch(/\n {3}\n/);
  });
});
