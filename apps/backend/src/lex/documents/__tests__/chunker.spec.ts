import {
  buildFullText,
  chunkText,
  sanitizeForStorage,
  stitchChunks
} from "../chunker";

const NUL = String.fromCharCode(0);

describe("chunker", () => {
  it("buildFullText records a page range per page that round-trips to that page's text", () => {
    const { fullText, pageRanges } = buildFullText(["Page one.", "Page two."]);
    expect(pageRanges).toHaveLength(2);
    expect(fullText.slice(pageRanges[0].start, pageRanges[0].end)).toBe(
      "Page one."
    );
    expect(fullText.slice(pageRanges[1].start, pageRanges[1].end)).toBe(
      "Page two."
    );
  });

  // The citation-anchor invariant: a stored chunk's [charStart,charEnd) must slice back to
  // exactly its content, or every downstream citation deep-links to the wrong text.
  it("every chunk round-trips: fullText.slice(charStart, charEnd) === content", () => {
    const pages = [
      "A".repeat(5000) + "\n\nfirst boundary.\n\n" + "B".repeat(5000),
      "C".repeat(3000)
    ];
    const { fullText, pageRanges } = buildFullText(pages);
    const chunks = chunkText(fullText, pageRanges);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(fullText.slice(c.charStart, c.charEnd)).toBe(c.content);
      expect(c.pageFrom).toBeGreaterThanOrEqual(1);
      expect(c.pageTo).toBeGreaterThanOrEqual(c.pageFrom);
    }
  });

  it("covers the whole text: first chunk starts at 0, last ends at length, offsets increase", () => {
    const { fullText, pageRanges } = buildFullText(["x".repeat(12000)]);
    const chunks = chunkText(fullText, pageRanges);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[chunks.length - 1].charEnd).toBe(fullText.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart);
    }
  });

  it("produces no chunks for empty text", () => {
    const { fullText, pageRanges } = buildFullText([""]);
    expect(chunkText(fullText, pageRanges)).toHaveLength(0);
  });

  // A NUL byte in extracted text aborts the chunk INSERT with `invalid byte sequence for
  // encoding "UTF8": 0x00` and fails the whole document — three files of the first real
  // 65-document bundle died exactly this way.
  describe("sanitizeForStorage", () => {
    it("strips the NUL bytes Postgres refuses to store", () => {
      expect(sanitizeForStorage(`Article ${NUL}1382 C.civ.`)).toBe(
        "Article 1382 C.civ."
      );
      expect(sanitizeForStorage(NUL + NUL)).toBe("");
    });

    it("keeps the whitespace that carries document structure", () => {
      const structured = "Heading\tA\nline\r\nnext\fpage";
      expect(sanitizeForStorage(structured)).toBe(structured);
    });

    it("removes the stray control and C1 bytes a mis-decoded binary leaves behind", () => {
      const junk = [0x01, 0x0b, 0x1f, 0x7f, 0x90]
        .map((code) => String.fromCharCode(code))
        .join("");
      expect(sanitizeForStorage(`before${junk}after`)).toBe("beforeafter");
    });

    it("removes unpaired surrogates (unencodable) but keeps real astral characters", () => {
      expect(sanitizeForStorage("signed \ud800here")).toBe("signed here");
      expect(sanitizeForStorage("signed \u{1f4dd} here")).toBe(
        "signed \u{1f4dd} here"
      );
    });

    it("leaves clean legal prose untouched and is idempotent", () => {
      const clean =
        "Le défendeur reconnaît « l'existence » d'une créance — 1 500 €.";
      expect(sanitizeForStorage(clean)).toBe(clean);
      expect(sanitizeForStorage(sanitizeForStorage(clean))).toBe(clean);
    });

    // The reason the sanitiser runs BEFORE buildFullText: sanitising later would shift the text
    // under offsets already stored on the chunks, and every citation deep-link would drift.
    it("sanitising the pages first keeps every chunk round-trippable and NUL-free", () => {
      const dirty = [
        "A".repeat(3000) + NUL + "\n\nboundary.\n\n" + "B".repeat(3000),
        ("C" + NUL).repeat(1500)
      ];
      const { fullText, pageRanges } = buildFullText(
        dirty.map(sanitizeForStorage)
      );
      const chunks = chunkText(fullText, pageRanges);
      expect(chunks.length).toBeGreaterThan(1);
      expect(fullText).not.toContain(NUL);
      for (const c of chunks) {
        expect(fullText.slice(c.charStart, c.charEnd)).toBe(c.content);
        expect(c.content).not.toContain(NUL);
      }
    });
  });

  // Re-summarizing rebuilds the text from stored chunks instead of re-fetching and re-OCRing
  // the source. Chunks overlap by 600 chars, so naive concatenation would duplicate text and
  // feed the summarizer a document that says everything twice.
  describe("stitchChunks", () => {
    it("reconstructs the original text exactly from overlapping chunks", () => {
      const pages = [
        "A".repeat(5000) + "\n\nfirst boundary.\n\n" + "B".repeat(5000),
        "C".repeat(3000)
      ];
      const { fullText, pageRanges } = buildFullText(pages);
      const chunks = chunkText(fullText, pageRanges);
      expect(chunks.length).toBeGreaterThan(1);
      expect(stitchChunks(chunks)).toBe(fullText);
    });

    it("is order-independent (rows may come back in any order)", () => {
      const { fullText, pageRanges } = buildFullText(["y".repeat(14000)]);
      const chunks = chunkText(fullText, pageRanges);
      expect(stitchChunks([...chunks].reverse())).toBe(fullText);
    });

    it("does not duplicate the overlap between two adjacent chunks", () => {
      const stitched = stitchChunks([
        { content: "abcdef", charStart: 0, charEnd: 6 },
        { content: "defghi", charStart: 3, charEnd: 9 }
      ]);
      expect(stitched).toBe("abcdefghi");
    });

    it("drops a chunk wholly covered by an earlier one", () => {
      const stitched = stitchChunks([
        { content: "abcdefghi", charStart: 0, charEnd: 9 },
        { content: "def", charStart: 3, charEnd: 6 }
      ]);
      expect(stitched).toBe("abcdefghi");
    });

    it("returns empty string when there are no chunks", () => {
      expect(stitchChunks([])).toBe("");
    });
  });
});
