import { buildFullText } from "../chunker";
import {
  assertPageRoundTrip,
  buildPageRows,
  continuesInto,
  fingerprintOf,
  quoteSpanIn
} from "../pager";

describe("pager", () => {
  describe("buildPageRows", () => {
    // The invariant every page-anchored citation resolves through. The chunker asserts the same
    // thing for chunks; the two grains must agree on offsets or a citation resolved through one
    // will not resolve through the other.
    it("every page round-trips: fullText.slice(charStart, charEnd) === text", () => {
      const { fullText, pageRanges } = buildFullText([
        "Page one text.",
        "Page two text.",
        "Page three text."
      ]);
      const rows = buildPageRows(fullText, pageRanges, { kind: "page" });
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(fullText.slice(row.charStart, row.charEnd)).toBe(row.text);
      }
      expect(() => assertPageRoundTrip(fullText, rows)).not.toThrow();
    });

    it("assertPageRoundTrip throws when a row's offsets drift", () => {
      const { fullText, pageRanges } = buildFullText(["alpha", "beta"]);
      const rows = buildPageRows(fullText, pageRanges, { kind: "page" });
      rows[1].charStart += 1; // simulate an off-by-one in a future change
      expect(() => assertPageRoundTrip(fullText, rows)).toThrow(
        /page offset mismatch at ordinal 2/
      );
    });

    it("numbers real pages and labels them p. n", () => {
      const { fullText, pageRanges } = buildFullText(["one", "two"]);
      const rows = buildPageRows(fullText, pageRanges, { kind: "page" });
      expect(rows.map((r) => r.pageNumber)).toEqual([1, 2]);
      expect(rows.map((r) => r.pageLabel)).toEqual(["p. 1", "p. 2"]);
      expect(rows.map((r) => r.pageOrigin)).toEqual(["page", "page"]);
    });

    // A spreadsheet has sheets, not pages: "p. 2" would be a lie a citation then repeats.
    it("labels spreadsheet rows by sheet name and refuses to invent page numbers", () => {
      const { fullText, pageRanges } = buildFullText([
        "# Facturen\na,b",
        "# Saldi\nc,d"
      ]);
      const rows = buildPageRows(fullText, pageRanges, {
        kind: "sheet",
        sheetNames: ["Facturen", "Saldi"]
      });
      expect(rows.map((r) => r.pageLabel)).toEqual([
        "sheet: Facturen",
        "sheet: Saldi"
      ]);
      expect(rows.every((r) => r.pageNumber === null)).toBe(true);
      expect(rows.every((r) => r.pageOrigin === "sheet")).toBe(true);
    });

    // docx / email / txt / transcripts arrive as ONE blob. Sections are honest; pages are not.
    it("sub-divides a single blob into sections with no page numbers", () => {
      const blob = Array.from(
        { length: 12 },
        (_, i) => `Paragraph ${i} ` + "x".repeat(700)
      ).join("\n\n");
      const { fullText, pageRanges } = buildFullText([blob]);
      const rows = buildPageRows(fullText, pageRanges, { kind: "blob" });
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.every((r) => r.pageNumber === null)).toBe(true);
      expect(rows.every((r) => r.pageOrigin === "section")).toBe(true);
      expect(rows[0].pageLabel).toBe("§1");
      // Sections must still tile the text exactly — nothing dropped, nothing duplicated.
      expect(rows.map((r) => r.text).join("")).toBe(fullText);
      expect(() => assertPageRoundTrip(fullText, rows)).not.toThrow();
    });

    it("labels a short blob 'whole document' rather than §1", () => {
      const { fullText, pageRanges } = buildFullText(["A short letter."]);
      const rows = buildPageRows(fullText, pageRanges, { kind: "blob" });
      expect(rows).toHaveLength(1);
      expect(rows[0].pageLabel).toBe("whole document");
    });
  });

  describe("continuesInto", () => {
    it("flags a page whose sentence runs into the next", () => {
      expect(
        continuesInto("…the defendant acknowledges that", "the debt was paid")
      ).toBe(true);
    });

    it("does not flag a page ending on a full stop followed by a new sentence", () => {
      expect(
        continuesInto("The claim is prescribed.", "Article 2262 provides…")
      ).toBe(false);
    });

    it("flags an abbreviation expecting its number on the next page", () => {
      expect(continuesInto("conformément à l'art.", "374 du Code civil")).toBe(
        true
      );
      expect(continuesInto("voir pp.", "12-14 du dossier")).toBe(true);
    });

    // A page starting with a digit is usually a numbered heading, not a continuation — exactly the
    // shape of the real filings in this case file ("3. Financement de la propriété").
    it("does not flag a numbered heading opening the next page", () => {
      expect(
        continuesInto("…et n'ont pas été rapportées.", "3. Financement")
      ).toBe(false);
    });

    it("flags when the next page opens lower-case after a full stop", () => {
      expect(continuesInto("La créance est établie.", "elle demeure due")).toBe(
        true
      );
    });

    it("is false for the last page", () => {
      expect(continuesInto("Final page.", undefined)).toBe(false);
    });
  });

  describe("fingerprintOf", () => {
    // The same annex appears in several bundles of a real court file; the document-level sha256
    // cannot see it because the surrounding documents differ.
    it("matches the same page text across two documents", () => {
      const text = "Annexe 3 — extrait de compte ".repeat(20);
      expect(fingerprintOf(text)).toBe(fingerprintOf(text));
      expect(fingerprintOf(text)).not.toBeNull();
    });

    it("ignores whitespace and case differences from a re-scan", () => {
      const a = "Reçu de dépôt recommandé ".repeat(20);
      const b = a.toUpperCase().replace(/ /g, "  ");
      expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    });

    it("returns null for text too short to identify", () => {
      expect(fingerprintOf("p. 4")).toBeNull();
      expect(fingerprintOf("")).toBeNull();
    });
  });

  describe("quoteSpanIn", () => {
    // Asserts the INVARIANT rather than hardcoded offsets: the returned span must slice back to
    // exactly the quote. That is the property every page-anchored citation deep-link relies on.
    it("returns a span that slices back to exactly the quote", () => {
      const page = "Le défendeur reconnaît une créance de 1 500 €.";
      const quote = "une créance de 1 500 €";
      const span = quoteSpanIn(page, quote);
      expect(span).not.toBeNull();
      expect(page.slice(span!.start, span!.end)).toBe(quote);
    });

    // A normalised-only match proves presence but not position, so callers must not get offsets.
    it("returns null when the quote differs by whitespace", () => {
      expect(quoteSpanIn("a  b", "a b")).toBeNull();
    });

    it("returns null when absent", () => {
      expect(quoteSpanIn("nothing here", "missing")).toBeNull();
    });
  });
});
