import type { BundleCitationRow, BundleMeta } from "../message-bundle";
import {
  bundleFilename,
  entryNameFor,
  planBundle,
  renderAnswer,
  renderReferences,
  sanitizeFilename
} from "../message-bundle";

/**
 * The bundle is what a lawyer hands to the next lawyer, so its failures are quiet ones: a pièce
 * silently overwritten by another of the same name, a marker that disappears from the table because
 * the document was deleted, a row pointing at a file the zip does not contain. Each of those is a
 * test here.
 */

function row(over: Partial<BundleCitationRow> = {}): BundleCitationRow {
  return {
    marker: 1,
    documentId: "doc-1",
    filename: "CONCLUSIONS_24_08_2024.pdf",
    pageLabel: null,
    pageFrom: 12,
    pageTo: 12,
    s3Key: "lex/x/ws-1/doc-1/original.pdf",
    s3VersionId: null,
    sizeBytes: 1024,
    ...over
  };
}

const meta: BundleMeta = {
  messageId: "11112222-3333-4444-5555-666677778888",
  conversationTitle: "Succession Pirson",
  createdAt: "2026-09-03T10:00:00.000Z",
  content:
    "L'état liquidatif retient 226.956,52 EUR [401] contre Monique Pirson."
};

describe("planBundle", () => {
  it("ships one file per document however many markers cite it", () => {
    const plan = planBundle([
      row({ marker: 401 }),
      row({ marker: 407 }),
      row({ marker: 412, documentId: "doc-2", filename: "Inventaire.pdf" })
    ]);

    expect(plan.documents).toHaveLength(2);
    expect(plan.documents[0].citations.map((c) => c.marker)).toEqual([
      401, 407
    ]);
    // Deduplicated by id, so the size ceiling counts the PDF once — not once per marker.
    expect(plan.totalBytes).toBe(2048);
  });

  it("orders documents by the first marker that cites them", () => {
    const plan = planBundle([
      row({ marker: 500, documentId: "doc-late", filename: "Tardif.pdf" }),
      row({ marker: 12, documentId: "doc-early", filename: "Citation.pdf" })
    ]);
    expect(plan.documents.map((d) => d.documentId)).toEqual([
      "doc-early",
      "doc-late"
    ]);
    expect(plan.documents[0].entryName).toBe("pieces/01_Citation.pdf");
  });

  it("keeps a citation whose document was deleted, as an orphan", () => {
    // document_id is ON DELETE SET NULL: the marker outlives the pièce, and the passage is still
    // the thing the answer relied on.
    const plan = planBundle([
      row({ marker: 9, documentId: null, s3Key: null, filename: null })
    ]);
    expect(plan.documents).toHaveLength(0);
    expect(plan.orphans.map((c) => c.marker)).toEqual([9]);
  });

  it("treats a row with a document but no S3 key as an orphan too", () => {
    const plan = planBundle([row({ s3Key: null })]);
    expect(plan.documents).toHaveLength(0);
    expect(plan.orphans).toHaveLength(1);
  });
});

describe("entry naming", () => {
  it("never lets two pièces share one entry name", () => {
    // The same annex under the same name in two bundles is normal in a court file. Two zip entries
    // with one name is a file the reader loses without being told.
    const plan = planBundle([
      row({ marker: 1, documentId: "a", filename: "Farde F.pdf" }),
      row({ marker: 2, documentId: "b", filename: "Farde F.pdf" })
    ]);
    const names = plan.documents.map((d) => d.entryName);
    expect(new Set(names).size).toBe(2);
    expect(names).toEqual(["pieces/01_Farde F.pdf", "pieces/02_Farde F.pdf"]);
  });

  it("disambiguates when the numbering itself collides", () => {
    const taken = new Set<string>();
    expect(entryNameFor("a.pdf", 1, taken)).toBe("pieces/01_a.pdf");
    expect(entryNameFor("a.pdf", 1, taken)).toBe("pieces/01_a (2).pdf");
    expect(entryNameFor("A.PDF", 1, taken)).toBe("pieces/01_A (3).PDF");
  });

  it("defuses path traversal and reserved characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_etc_passwd");
    expect(sanitizeFilename("a:b|c?.pdf")).toBe("a_b_c_.pdf");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("   ")).toBe("document");
  });
});

describe("renderReferences", () => {
  const plan = planBundle([
    row({ marker: 401 }),
    row({ marker: 407, pageFrom: 14, pageTo: 15 }),
    row({
      marker: 412,
      documentId: "doc-2",
      filename: "Inventaire.pdf",
      pageFrom: null,
      pageTo: null,
      pageLabel: "sheet: Facturen"
    }),
    row({ marker: 9, documentId: null, s3Key: null, filename: "Farde F.pdf" })
  ]);

  it("gives every marker a row with its pièce and page", () => {
    const md = renderReferences(plan, meta);
    expect(md).toContain(
      "| [401] | CONCLUSIONS_24_08_2024.pdf | p. 12 | `pieces/01_CONCLUSIONS_24_08_2024.pdf` |"
    );
    expect(md).toContain("| [407] | CONCLUSIONS_24_08_2024.pdf | p. 14-15 |");
    // A spreadsheet has no page number, and inventing one would be a reference to nowhere.
    expect(md).toContain("| [412] | Inventaire.pdf | sheet: Facturen |");
  });

  it("reads in marker order, which is the order the answer is read in", () => {
    const markers = [
      ...renderReferences(plan, meta).matchAll(/^\| \[(\d+)\]/gm)
    ].map((m) => Number(m[1]));
    expect(markers).toEqual([9, 401, 407, 412]);
  });

  it("carries no passages: the pièce is one page reference away", () => {
    expect(renderReferences(plan, meta)).not.toContain(
      "L'état liquidatif retient"
    );
  });

  it("counts every reference, including the ones with no file", () => {
    expect(renderReferences(plan, meta)).toContain(
      "**Références :** 4 · **Pièces :** 2"
    );
  });

  it("keeps a deleted pièce's marker in the table rather than dropping it", () => {
    expect(renderReferences(plan, meta)).toContain(
      "| [9] | Farde F.pdf | p. 12 | non joint (pièce retirée du dossier) |"
    );
  });

  it("says which pièce failed to download instead of pointing at a file that is not there", () => {
    const md = renderReferences(
      plan,
      meta,
      new Map([["doc-2", "fichier introuvable"]])
    );
    expect(md).toContain(
      "| [412] | Inventaire.pdf | sheet: Facturen | non joint (fichier introuvable) |"
    );
    expect(md).not.toContain("`pieces/02_Inventaire.pdf`");
  });
});

describe("renderAnswer", () => {
  it("keeps the markers, which are the index into everything else", () => {
    expect(renderAnswer(meta)).toContain("226.956,52 EUR [401]");
  });
});

describe("bundleFilename", () => {
  it("is ASCII, because Content-Disposition is latin-1 on the wire", () => {
    const name = bundleFilename({
      ...meta,
      conversationTitle: "Succession Pirson — état liquidatif"
    });
    expect(name).toBe(
      "pieces-citees-succession-pirson-etat-liquidatif-11112222.zip"
    );
    expect(/^[\x20-\x7e]+$/.test(name)).toBe(true);
  });

  it("still produces a name for an untitled conversation", () => {
    expect(bundleFilename({ ...meta, conversationTitle: null })).toBe(
      "pieces-citees-dossier-11112222.zip"
    );
  });
});
