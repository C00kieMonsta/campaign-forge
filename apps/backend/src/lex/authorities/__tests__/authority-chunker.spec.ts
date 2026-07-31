import { buildFullText, sanitizeForStorage } from "../../documents/chunker";
import {
  chunkAuthority,
  countArticles,
  normalizeArticleLabel,
  stripArticleHeading
} from "../authority-chunker";

const NUL = String.fromCharCode(0);

/** A miniature code, in the shape the real PDFs come out in. */
const CODE = [
  "CODE CIVIL",
  "Livre 1er — Des personnes",
  "",
  "Art. 371. Chacun doit respect à ses père et mère.",
  "",
  "Article 372",
  "L'enfant reste sous l'autorité de ses père et mère jusqu'à sa majorité.",
  "",
  "Art. 374bis - Le juge peut confier l'hébergement à l'un des parents.",
  "",
  "Art. 374/1. Le tribunal de la famille est saisi par requête.",
  "",
  "Artikel 375",
  "De ouders oefenen samen het ouderlijk gezag uit.",
  "",
  "Art. 1382-1383",
  "Tout fait quelconque de l'homme qui cause à autrui un dommage.",
  ""
].join("\n");

describe("authority-chunker", () => {
  describe("chunkAuthority", () => {
    it("splits on article headings and labels each chunk with its article", () => {
      const { fullText, pageRanges } = buildFullText([CODE]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks.map((c) => c.articleLabel)).toEqual([
        null, // the cover / book heading before the first article
        "Art. 371",
        "Art. 372",
        "Art. 374bis",
        "Art. 374/1",
        "Art. 375",
        "Art. 1382-1383"
      ]);
      expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    // The citation-anchor invariant, identical to the document chunker's: a stored chunk's
    // [charStart,charEnd) must slice back to exactly its content, or a citation deep-links into
    // the wrong article of the code.
    it("every chunk round-trips: fullText.slice(charStart, charEnd) === content", () => {
      const { fullText, pageRanges } = buildFullText([
        CODE,
        `Art. 500. ${"a".repeat(9000)}`
      ]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks.length).toBeGreaterThan(7);
      for (const c of chunks) {
        expect(fullText.slice(c.charStart, c.charEnd)).toBe(c.content);
        expect(c.pageFrom).toBeGreaterThanOrEqual(1);
        expect(c.pageTo).toBeGreaterThanOrEqual(c.pageFrom);
      }
    });

    it("keeps the heading inside the chunk it introduces", () => {
      const { fullText, pageRanges } = buildFullText([CODE]);
      const chunks = chunkAuthority(fullText, pageRanges);
      const art372 = chunks.find((c) => c.articleLabel === "Art. 372");
      expect(art372?.content.startsWith("Article 372")).toBe(true);
      expect(art372?.content).toContain("jusqu'à sa majorité");
    });

    it("splits an over-long article into several chunks that all carry its label", () => {
      const { fullText, pageRanges } = buildFullText([
        `Art. 42.\n\n${"Le juge apprécie. ".repeat(1200)}`
      ]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks.length).toBeGreaterThan(3);
      expect(chunks.every((c) => c.articleLabel === "Art. 42")).toBe(true);
      // Still one article, however many chunks it took.
      expect(countArticles(chunks)).toBe(1);
      for (const c of chunks) {
        expect(fullText.slice(c.charStart, c.charEnd)).toBe(c.content);
      }
    });

    // A cross-reference is the most common string in a code; treating one as a heading would cut
    // the article containing it in two and file the remainder under the referenced number.
    it("ignores article references inside prose (mid-line)", () => {
      const { fullText, pageRanges } = buildFullText([
        "Art. 387. Par dérogation à l'article 373 et à l'art. 374, le juge statue."
      ]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].articleLabel).toBe("Art. 387");
    });

    it("reads a heading number range but not a body that merely starts with a number", () => {
      const range = buildFullText(["Art. 1382-1383\nTout fait quelconque."]);
      expect(
        chunkAuthority(range.fullText, range.pageRanges)[0].articleLabel
      ).toBe("Art. 1382-1383");

      // "- 1." counts DOWN from 374, so it is the body of article 374, not a range.
      const body = buildFullText(["Art. 374 - 1. Le juge statue.\n"]);
      expect(
        chunkAuthority(body.fullText, body.pageRanges)[0].articleLabel
      ).toBe("Art. 374");
    });

    it("counts a table-of-contents line and its article as one article", () => {
      const { fullText, pageRanges } = buildFullText([
        "TABLE\nArt. 371. Respect ......... 12\n\nArt. 371. Chacun doit respect.\n"
      ]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks.filter((c) => c.articleLabel === "Art. 371")).toHaveLength(
        2
      );
      expect(countArticles(chunks)).toBe(1);
    });

    it("produces no chunks for empty text and one unlabelled chunk for article-free text", () => {
      const empty = buildFullText([""]);
      expect(chunkAuthority(empty.fullText, empty.pageRanges)).toHaveLength(0);

      const judgment = buildFullText([
        "Arrêt de la Cour de cassation du 3 mars 2020."
      ]);
      const chunks = chunkAuthority(judgment.fullText, judgment.pageRanges);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].articleLabel).toBeNull();
      expect(countArticles(chunks)).toBe(0);
    });

    it("tracks the page each article sits on", () => {
      const { fullText, pageRanges } = buildFullText([
        "Art. 1er. Première page.",
        "Art. 2. Deuxième page.",
        "Art. 3. Troisième page."
      ]);
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(chunks.map((c) => [c.articleLabel, c.pageFrom])).toEqual([
        ["Art. 1er", 1],
        ["Art. 2", 2],
        ["Art. 3", 3]
      ]);
    });

    // Sanitising has to happen before buildFullText, or it moves the text under the offsets the
    // chunks were built with — same reason as the document pipeline.
    it("stays round-trippable and NUL-free when the pages are sanitised first", () => {
      const { fullText, pageRanges } = buildFullText(
        [
          `Art. 371.${NUL} Chacun doit respect.`,
          `Art. 372.${NUL} L'enfant.`
        ].map(sanitizeForStorage)
      );
      const chunks = chunkAuthority(fullText, pageRanges);
      expect(fullText).not.toContain(NUL);
      for (const c of chunks) {
        expect(fullText.slice(c.charStart, c.charEnd)).toBe(c.content);
        expect(c.content).not.toContain(NUL);
      }
    });
  });

  // Both sides of an exact article lookup go through this, so the storage side and the query
  // side can never disagree about what "374bis" is called.
  describe("normalizeArticleLabel", () => {
    it.each([
      ["374", "Art. 374"],
      ["Art. 374", "Art. 374"],
      ["art 374", "Art. 374"],
      ["Article 374", "Art. 374"],
      ["Artikel 374", "Art. 374"],
      ["ARTIKEL 374", "Art. 374"],
      ["Art. 374bis", "Art. 374bis"],
      ["art 374 BIS", "Art. 374bis"],
      ["Art. 374/1", "Art. 374/1"],
      ["1er", "Art. 1er"],
      ["Art. 1382-1383", "Art. 1382-1383"],
      ["Art. 374.", "Art. 374"],
      ["  art. 374  ", "Art. 374"]
    ])("canonicalises %s to %s", (input, expected) => {
      expect(normalizeArticleLabel(input)).toBe(expected);
    });

    it("agrees with the label the chunker stored", () => {
      const { fullText, pageRanges } = buildFullText([CODE]);
      const stored = chunkAuthority(fullText, pageRanges)
        .map((c) => c.articleLabel)
        .filter((l): l is string => l !== null);
      for (const label of stored) {
        expect(normalizeArticleLabel(label)).toBe(label);
      }
    });

    // Guessing which number in a sentence is the citation is how the wrong article gets quoted.
    it.each([
      "Art. 374 du Code civil",
      "the parental authority chapter",
      "",
      "articles"
    ])("refuses %p rather than guessing", (input) => {
      expect(normalizeArticleLabel(input)).toBeNull();
    });
  });

  describe("stripArticleHeading", () => {
    it("drops the heading and its separator, keeping the article's text", () => {
      expect(stripArticleHeading("Art. 371. Chacun doit respect.")).toBe(
        "Chacun doit respect."
      );
      expect(stripArticleHeading("Article 372 — L'enfant reste.")).toBe(
        "L'enfant reste."
      );
      expect(stripArticleHeading("Art. 374/1: Le tribunal.")).toBe(
        "Le tribunal."
      );
    });

    it("leaves text that does not open with a heading alone", () => {
      expect(stripArticleHeading("Tout fait quelconque de l'homme.")).toBe(
        "Tout fait quelconque de l'homme."
      );
    });
  });
});
