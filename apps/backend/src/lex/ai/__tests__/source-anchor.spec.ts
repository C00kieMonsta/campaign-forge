import { sourceKey, withoutPinned, type RetrievedChunk } from "../rag.service";

// These guard the anchor contract, not a query. A page and a chunk are rows in DIFFERENT tables
// with DIFFERENT foreign keys in lex_citations, and conflating them put a lex_document_pages id
// into lex_citations.chunk_id — a 23503 inside the finalize transaction, which rolled back
// `status = 'complete'` and destroyed an answer the user had already watched stream in.

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: "11111111-1111-1111-1111-111111111111",
  pageId: null,
  pageOrdinal: null,
  pageTextHash: null,
  documentId: "doc-1",
  filename: "Dagvaarding.pdf",
  pageFrom: 4,
  pageTo: 8,
  charStart: 12000,
  charEnd: 16000,
  content: "…",
  score: 0.5,
  ...over
});

const page = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: null,
  pageId: "22222222-2222-2222-2222-222222222222",
  pageOrdinal: 6,
  pageTextHash: "deadbeef",
  documentId: "doc-1",
  filename: "Dagvaarding.pdf",
  pageFrom: 6,
  pageTo: 6,
  charStart: 13000,
  charEnd: 14870,
  content: "…",
  score: Number.POSITIVE_INFINITY,
  ...over
});

// The "exactly one anchor is set" invariant is asserted against the REAL retrievePinned in
// retrieve-pinned-anchor.spec.ts. Asserting it on the fixtures below would only prove the fixtures.
describe("source anchors", () => {
  it("prefixes the identity by table so the two id spaces cannot be compared or misused", () => {
    expect(sourceKey(chunk())).toBe(
      "chunk:11111111-1111-1111-1111-111111111111"
    );
    expect(sourceKey(page())).toBe("page:22222222-2222-2222-2222-222222222222");
    // Prefixed means a bare uuid column rejects it loudly rather than violating a constraint.
    expect(sourceKey(page())).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("never produces the same key for a page and a chunk that share a uuid", () => {
    const shared = "33333333-3333-3333-3333-333333333333";
    expect(sourceKey(chunk({ chunkId: shared }))).not.toBe(
      sourceKey(page({ pageId: shared }))
    );
  });

  describe("withoutPinned", () => {
    // Before the page index existed, both sides were chunk ids so an id-set filter worked. Once a
    // document has page rows, a pinned page and a searched chunk of the SAME passage are different
    // rows with different ids — an id filter silently stops matching and the same text is billed
    // twice under two [n] markers.
    it("drops a searched chunk whose text a pinned page already covers", () => {
      const pinned = [page()]; // chars 13000-14870
      const searched = [chunk()]; // chars 12000-16000 — contains the pinned page
      expect(withoutPinned(searched, pinned)).toEqual([]);
    });

    it("keeps a searched chunk that does not overlap the pin", () => {
      const pinned = [page({ charStart: 100, charEnd: 900 })];
      const searched = [chunk({ charStart: 12000, charEnd: 16000 })];
      expect(withoutPinned(searched, pinned)).toHaveLength(1);
    });

    it("keeps a chunk from a different document even at identical offsets", () => {
      const pinned = [page({ documentId: "doc-1" })];
      const searched = [
        chunk({ documentId: "doc-2", charStart: 13000, charEnd: 14870 })
      ];
      expect(withoutPinned(searched, pinned)).toHaveLength(1);
    });

    it("treats spans as half-open, so touching end-to-start is not an overlap", () => {
      const pinned = [page({ charStart: 0, charEnd: 1000 })];
      const searched = [chunk({ charStart: 1000, charEnd: 2000 })];
      expect(withoutPinned(searched, pinned)).toHaveLength(1);
    });

    it("still dedups by identity when both sides are chunks (the pre-page-index path)", () => {
      const same = chunk({ charStart: null, charEnd: null });
      expect(withoutPinned([same], [same])).toEqual([]);
    });

    it("keeps a span with unknown offsets rather than guessing it is covered", () => {
      // charStart null means the anchor is unknown; dropping it would silently lose a source.
      const pinned = [page()];
      const searched = [
        chunk({
          chunkId: "44444444-4444-4444-4444-444444444444",
          charStart: null,
          charEnd: null
        })
      ];
      expect(withoutPinned(searched, pinned)).toHaveLength(1);
    });

    it("returns everything when nothing is pinned", () => {
      const searched = [chunk(), chunk({ chunkId: "other" })];
      expect(withoutPinned(searched, [])).toHaveLength(2);
    });
  });
});
