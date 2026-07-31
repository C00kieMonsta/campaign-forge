import type { OpenAiService } from "../../../shared/openai.service";
import type { PgService } from "../../../shared/pg.service";
import { pageTextHash } from "../../documents/pager";
import { RagService } from "../rag.service";

// Exercises the REAL retrievePinned. The point is the shape of what it returns for a PAGE row:
// ConversationsService writes `chunkId` into lex_citations.chunk_id, whose FK targets
// lex_document_chunks, so a page id arriving in that field is Postgres 23503 inside the finalize
// transaction — which rolls back `status = 'complete'` and loses an answer already paid for and
// already streamed to the user.

const PAGE_ID = "22222222-2222-2222-2222-222222222222";
const CHUNK_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "33333333-3333-3333-3333-333333333333";

function pageRow(over: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    document_id: DOC_ID,
    filename: "Dagvaarding.pdf",
    ordinal: 6,
    page_number: 6,
    page_label: "p. 6",
    char_start: 13000,
    char_end: 14870,
    text: "Le tribunal constate que la créance est établie.",
    ...over
  };
}

function chunkRow(over: Record<string, unknown> = {}) {
  return {
    id: CHUNK_ID,
    document_id: DOC_ID,
    filename: "Dagvaarding.pdf",
    page_from: 4,
    page_to: 8,
    char_start: 12000,
    char_end: 16000,
    content: "…a 4000-char window spanning pages 4 to 8…",
    ...over
  };
}

/** A PgService whose every query returns the next queued result. */
function fakePg(results: { rows: unknown[] }[]) {
  const query = jest.fn(async () => results.shift() ?? { rows: [] });
  return { query } as unknown as PgService & { query: jest.Mock };
}

const openai = {} as OpenAiService;

describe("retrievePinned anchors", () => {
  it("returns a PAGE anchor with chunkId null, so no page id can reach lex_citations.chunk_id", async () => {
    const pg = fakePg([{ rows: [pageRow()] }]);
    const rag = new RagService(pg, openai);

    const [source] = await rag.retrievePinned("lawyer@example.com", "ws-1", [
      { documentId: DOC_ID, pages: [6] }
    ]);

    // The assertion the FK depends on.
    expect(source.chunkId).toBeNull();
    expect(source.pageId).toBe(PAGE_ID);
    expect(source.pageOrdinal).toBe(6);
  });

  it("cites the page's OWN number, not the envelope of an overlapping chunk", async () => {
    const pg = fakePg([{ rows: [pageRow()] }]);
    const rag = new RagService(pg, openai);

    const [source] = await rag.retrievePinned("lawyer@example.com", "ws-1", [
      { documentId: DOC_ID, pages: [6] }
    ]);

    expect(source.pageFrom).toBe(6);
    expect(source.pageTo).toBe(6);
  });

  it("hashes the FULL page text with pageTextHash, so a later rebuild can re-anchor the citation", async () => {
    const row = pageRow();
    const pg = fakePg([{ rows: [row] }]);
    const rag = new RagService(pg, openai);

    // A budget below the page length, so `content` is truncated: the hash must NOT follow it.
    const [source] = await rag.retrievePinned(
      "lawyer@example.com",
      "ws-1",
      [{ documentId: DOC_ID, pages: [6] }],
      10
    );

    expect(source.content.length).toBe(10);
    expect(source.pageTextHash).toBe(pageTextHash(row.text));
    // Hashing the truncated content would make every re-anchor after a rebuild miss.
    expect(source.pageTextHash).not.toBe(pageTextHash(source.content));
  });

  it("falls back to a CHUNK anchor when the document has no page index yet", async () => {
    // First query (pages) empty → pinnedFromChunks runs and its rows are chunk-anchored.
    const pg = fakePg([{ rows: [] }, { rows: [chunkRow()] }]);
    const rag = new RagService(pg, openai);

    const [source] = await rag.retrievePinned("lawyer@example.com", "ws-1", [
      { documentId: DOC_ID, pages: [6] }
    ]);

    expect(source.chunkId).toBe(CHUNK_ID);
    expect(source.pageId).toBeNull();
    expect(source.pageTextHash).toBeNull();
  });

  it("selects the ordinal it needs, and filters pages by set membership not by range", async () => {
    const pg = fakePg([{ rows: [pageRow()] }]);
    const rag = new RagService(pg, openai);

    await rag.retrievePinned("lawyer@example.com", "ws-1", [
      { documentId: DOC_ID, pages: [2, 40] }
    ]);

    const [sql, params] = pg.query.mock.calls[0];
    expect(sql).toContain("p.ordinal");
    // ANY(...), not BETWEEN: pinning [2, 40] must return two pages, not thirty-nine.
    expect(sql).toContain("p.ordinal = ANY($4::int[])");
    expect(params).toEqual(["ws-1", "lawyer@example.com", DOC_ID, [2, 40]]);
  });

  it("stays scoped to the owner, the workspace and active documents only", async () => {
    const pg = fakePg([{ rows: [pageRow()] }]);
    const rag = new RagService(pg, openai);

    await rag.retrievePinned("lawyer@example.com", "ws-1", [
      { documentId: DOC_ID, pages: [] }
    ]);

    const [sql] = pg.query.mock.calls[0];
    expect(sql).toContain("p.workspace_id = $1");
    expect(sql).toContain("p.owner_email = $2");
    // A pin must never resurrect a superseded duplicate.
    expect(sql).toContain("d.lifecycle_state = 'active'");
  });
});
