import { extractText } from "unpdf";
import { buildFullText } from "../chunker";
import { parseDocument } from "../document-parser";
import { buildPageRows } from "../pager";

// unpdf is mocked so the page COUNT can be controlled without carrying real PDF fixtures. What is
// under test is not pdf.js, it is the pageKind the parser reports for what pdf.js returns.
jest.mock("unpdf", () => ({
  getDocumentProxy: jest.fn(async () => ({})),
  extractText: jest.fn()
}));

const mockExtract = extractText as jest.MockedFunction<typeof extractText>;
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n");

function returns(pages: string[]): void {
  mockExtract.mockResolvedValue({
    totalPages: pages.length,
    text: pages
  } as unknown as Awaited<ReturnType<typeof extractText>>);
}

describe("a PDF's pages are always pages", () => {
  beforeEach(() => mockExtract.mockReset());

  it("labels a MULTI-page PDF as pages", async () => {
    returns(["page one text", "page two text"]);
    const parsed = await parseDocument(PDF_BYTES, "application/pdf", "a.pdf");
    expect(parsed.pageKind).toBe("page");
  });

  // The regression. `parsed()` defaults pageKind by array shape — one element looks like a text
  // blob — so a one-page PDF was reported as 'blob' and then sectioned. pdf.js told us it is a
  // page; the shape heuristic must not overrule that.
  it("labels a ONE-page PDF as a page, not a blob", async () => {
    returns(["a single page of a filing"]);
    const parsed = await parseDocument(PDF_BYTES, "application/pdf", "a.pdf");
    expect(parsed.pageKind).toBe("page");
  });

  // Why it matters, end to end: the viewer rasterises the PDF, pdf.js reports numPages = 1, the
  // user ticks "page 1", and retrievePinned matches that against a row's ordinal. If the single
  // page was split into sections, ordinal 1 is only the FIRST SLICE of it — so the model is handed
  // part of the page and told it is the whole pinned source.
  it("keeps a long one-page PDF as ONE addressable row instead of splitting it", async () => {
    // Over the 3000-char section target, which is what used to trigger the split.
    const longPage = "Le tribunal constate. ".repeat(400);
    returns([longPage]);

    const parsed = await parseDocument(PDF_BYTES, "application/pdf", "a.pdf");
    const { fullText, pageRanges } = buildFullText(parsed.pages);
    const rows = buildPageRows(fullText, pageRanges, {
      kind: parsed.pageKind,
      sheetNames: parsed.sheetNames
    });

    expect(longPage.length).toBeGreaterThan(3000);
    expect(rows).toHaveLength(1);
    expect(rows[0].pageNumber).toBe(1);
    expect(rows[0].pageLabel).toBe("p. 1");
    // Pinning page 1 must yield the entire page.
    expect(rows[0].text).toBe(fullText);
  });

  it("still treats a text blob with no pages as sections", async () => {
    // The shape default is right where the format genuinely has no pages — only PDFs are stated.
    const rows = buildPageRows(
      ...(() => {
        const built = buildFullText(["x".repeat(8000)]);
        return [built.fullText, built.pageRanges] as const;
      })(),
      { kind: "blob" }
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].pageNumber).toBeNull();
    expect(rows[0].pageLabel).toBe("§1");
  });

  it("routes an empty text layer to OCR rather than calling it a page of nothing", async () => {
    returns(["   ", ""]);
    const parsed = await parseDocument(
      PDF_BYTES,
      "application/pdf",
      "scan.pdf"
    );
    expect(parsed.needsOcr).toBe(true);
  });
});
