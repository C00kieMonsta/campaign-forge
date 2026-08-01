import { ARTIFACT_PACK_SIZE } from "@packages/types";
import type { RetrievedChunk } from "../../ai/rag.service";
import { summariseSources } from "../artifact-generation.service";

let nextChunk = 0;

/**
 * `sources` is the answer to "what did it actually read?" — the question the generate dialog used
 * to leave unanswered while writing a court document from twelve spans out of twelve thousand. It
 * is shown to the user beside the draft, so it has to be faithful to the pack rather than to the
 * citations, which are a smaller set.
 */
function chunk(documentId: string, filename: string): RetrievedChunk {
  return {
    chunkId: `c${(nextChunk += 1)}`,
    pageId: null,
    pageOrdinal: null,
    pageTextHash: null,
    documentId,
    filename,
    pageFrom: null,
    pageTo: null,
    charStart: null,
    charEnd: null,
    content: "…"
  } as RetrievedChunk;
}

describe("summariseSources", () => {
  it("counts the spans each pièce contributed", () => {
    const sources = summariseSources([
      chunk("d1", "requete.pdf"),
      chunk("d2", "contrat-1958.pdf"),
      chunk("d1", "requete.pdf"),
      chunk("d1", "requete.pdf")
    ]);
    expect(sources).toEqual([
      { documentId: "d1", filename: "requete.pdf", passages: 3 },
      { documentId: "d2", filename: "contrat-1958.pdf", passages: 1 }
    ]);
  });

  // The list is read top-down to judge what the draft rests on; a pièce contributing eleven spans
  // and one contributing a single passage are different facts about the draft.
  it("puts the most-drawn-upon pièce first", () => {
    const sources = summariseSources([
      chunk("thin", "annexe.pdf"),
      chunk("thick", "jugement.pdf"),
      chunk("thick", "jugement.pdf")
    ]);
    expect(sources.map((s) => s.documentId)).toEqual(["thick", "thin"]);
  });

  it("breaks ties on the filename, so two runs over one pack render identically", () => {
    const forward = summariseSources([
      chunk("b", "zebre.pdf"),
      chunk("a", "acte.pdf")
    ]);
    const reversed = summariseSources([
      chunk("a", "acte.pdf"),
      chunk("b", "zebre.pdf")
    ]);
    expect(forward).toEqual(reversed);
    expect(forward[0].filename).toBe("acte.pdf");
  });

  it("returns nothing for an empty pack rather than a row of zeroes", () => {
    // An empty pack means retrieval found nothing in the selection — the view must not imply a
    // pièce was read.
    expect(summariseSources([])).toEqual([]);
  });

  it("keeps two pièces that happen to share a filename apart", () => {
    // Uploading the same name twice is ordinary in a case file; merging them would overstate how
    // much of one document was read.
    const sources = summariseSources([
      chunk("d1", "courrier.pdf"),
      chunk("d2", "courrier.pdf")
    ]);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.passages)).toEqual([1, 1]);
  });
});

describe("the pack sizes the dialog promises", () => {
  // The dialog states these counts before the user commits to a run. They are shared with the
  // server precisely so the promise and the behaviour cannot drift apart.
  it("reads more in full than in search, and both are bounded", () => {
    expect(ARTIFACT_PACK_SIZE.search).toBeGreaterThan(0);
    expect(ARTIFACT_PACK_SIZE.full).toBeGreaterThan(ARTIFACT_PACK_SIZE.search);
    // A pack of every chunk in the dev corpus is 12 765 spans; "full" is a wider sample, not that.
    expect(ARTIFACT_PACK_SIZE.full).toBeLessThan(1000);
  });
});
