import type { LexS3Service } from "../../../shared/lex-s3.service";
import type { PgService } from "../../../shared/pg.service";
import type { WorkspacesService } from "../../workspaces/workspaces.service";
import type { DocumentRow } from "../documents.service";
import { DocumentsService } from "../documents.service";

/**
 * Archiving is a one-column UPDATE, so everything that decides whether it is SAFE lives in SQL that
 * tsc cannot see: whose rows move, which states are allowed to move, and which states a read is
 * allowed to hide. Two of those predicates are load-bearing beyond tidiness:
 *
 *   archive requires lifecycle_state = 'active'   — otherwise a 'superseded' duplicate could enter
 *                                                   the archive, and restore would be the thing
 *                                                   that resurrects it.
 *   restore requires lifecycle_state = 'archived' — same failure from the other end: without it,
 *                                                   restoring one document flips every duplicate in
 *                                                   the workspace back into retrieval and the same
 *                                                   passage becomes citable from two documents.
 *
 * Asserted against a stubbed PgService. For the read paths a stub is not enough — "the archived
 * document disappears from the list" is a claim about rows, not about a string — so those tests read
 * the lifecycle conjunct back out of the statement and apply it to a fixture corpus (see
 * applyArchivedScope).
 */

/** The statements are multi-line, so predicates are matched against a single-space form. */
const flat = (sql: string): string => sql.replace(/\s+/g, " ");

function docRow(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: "doc-1",
    workspace_id: "ws-1",
    owner_email: "lawyer@example.com",
    filename: "Dagvaarding.pdf",
    content_type: "application/pdf",
    size_bytes: "1024",
    s3_key: "lex/lawyer@example.com/ws-1/doc-1/original.pdf",
    s3_version_id: null,
    sha256: "a".repeat(64),
    parse_status: "ready",
    lifecycle_state: "active",
    timeline_date: "2019-04-12",
    page_count: 3,
    summary: "Donation à Monique Pirson.",
    language: "fr",
    key_names: ["Monique Pirson"],
    tags: ["succession"],
    duration_seconds: null,
    duplicate_of: null,
    source_path: null,
    error: null,
    metadata: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...over
  };
}

/**
 * The three lifecycle states that coexist in a real workspace. The 'superseded' row is the one that
 * makes these tests worth writing: it has always been returned by the documents reads (the view
 * labels it "doublon de …"), so a scope clause of `lifecycle_state = 'active'` would pass every
 * "archived is hidden" assertion while silently deleting a behaviour from the view.
 */
const CORPUS: DocumentRow[] = [
  docRow({ id: "d-active", filename: "Dagvaarding.pdf" }),
  docRow({
    id: "d-superseded",
    filename: "Annexe 2 (copie).pdf",
    parse_status: "duplicate",
    lifecycle_state: "superseded",
    duplicate_of: "d-active"
  }),
  docRow({
    id: "d-archived",
    filename: "Brouillon 2019.pdf",
    lifecycle_state: "archived"
  })
];

/**
 * Applies the statement's lifecycle conjunct to `rows`, so a read can be asserted on the documents
 * it yields instead of on the SQL it sent. Deliberately narrow: it recognises exactly the three
 * forms archivedScopeClause emits and throws on any other mention of the column, so a rewritten
 * predicate fails loudly here rather than quietly satisfying a `toContain`.
 */
function applyArchivedScope(sql: string, rows: DocumentRow[]): DocumentRow[] {
  const s = flat(sql);
  if (s.includes("AND lifecycle_state <> 'archived'"))
    return rows.filter((r) => r.lifecycle_state !== "archived");
  if (s.includes("AND lifecycle_state = 'archived'"))
    return rows.filter((r) => r.lifecycle_state === "archived");
  if (/AND\s+\w*\.?lifecycle_state/.test(s))
    throw new Error(`unrecognised lifecycle predicate in: ${s}`);
  return rows;
}

describe("DocumentsService archive and restore", () => {
  let pg: { query: jest.Mock; withTransaction: jest.Mock };
  let s3: { delete: jest.Mock };
  let workspaces: { getOrFail: jest.Mock };
  let service: DocumentsService;

  beforeEach(() => {
    pg = { query: jest.fn(), withTransaction: jest.fn() };
    s3 = { delete: jest.fn() };
    workspaces = { getOrFail: jest.fn().mockResolvedValue({ id: "ws-1" }) };
    service = new DocumentsService(
      pg as unknown as PgService,
      s3 as unknown as LexS3Service,
      workspaces as unknown as WorkspacesService
    );
  });

  describe("archiveMany", () => {
    it("moves the whole selection in a single statement", async () => {
      // deleteMany loops because each delete also has to talk to S3; this touches one column, so a
      // 55-document select-all must not become 55 round trips that can half-apply.
      pg.query.mockResolvedValue({ rows: [{ id: "a" }, { id: "b" }] });

      await service.archiveMany("lawyer@example.com", ["a", "b"]);

      expect(pg.query).toHaveBeenCalledTimes(1);
      expect(pg.withTransaction).not.toHaveBeenCalled();
      const [sql, params] = pg.query.mock.calls[0];
      expect(flat(sql)).toContain("UPDATE lex_documents");
      expect(flat(sql)).toContain("SET lifecycle_state = 'archived'");
      expect(flat(sql)).toContain("WHERE id = ANY($1::uuid[])");
      expect(params).toEqual([["a", "b"], "lawyer@example.com"]);
    });

    it("never archives another lawyer's documents", async () => {
      // Multi-tenant corpus, and the ids arrive from the browser: owner_email in the statement is
      // the only thing standing between one practitioner's selection and another's case file.
      pg.query.mockResolvedValue({ rows: [] });

      await service.archiveMany("lawyer@example.com", ["someone-elses-id"]);

      const [sql, params] = pg.query.mock.calls[0];
      expect(flat(sql)).toContain("AND owner_email = $2");
      expect(params[1]).toBe("lawyer@example.com");
    });

    it("only moves rows that are currently active, so a duplicate can never enter the archive", async () => {
      // The guard that keeps restoreMany safe: if a 'superseded' row could be archived, then
      // restoring it — archived → active — would re-arm a duplicate whose chunks and page rows
      // ingestion already deleted.
      pg.query.mockResolvedValue({ rows: [] });

      await service.archiveMany("lawyer@example.com", ["d-superseded"]);

      expect(flat(pg.query.mock.calls[0][0])).toContain(
        "AND lifecycle_state = 'active'"
      );
    });

    it("reports the rows that actually moved, not the ids it was asked about", async () => {
      // What Undo replays. Reporting the request back would make Undo restore documents this call
      // never archived — including ones the user had archived deliberately, earlier.
      pg.query.mockResolvedValue({ rows: [{ id: "b" }, { id: "c" }] });

      expect(
        await service.archiveMany("lawyer@example.com", ["a", "b", "c"])
      ).toEqual({ documentIds: ["b", "c"] });
    });

    it("is a silent no-op when nothing was eligible", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      expect(await service.archiveMany("lawyer@example.com", ["a"])).toEqual({
        documentIds: []
      });
    });

    it("destroys nothing: no row deleted, no S3 object touched", async () => {
      // The entire argument for archive over delete. Every lex_citations anchor stays valid only as
      // long as this path never becomes a delete in disguise.
      pg.query.mockResolvedValue({ rows: [{ id: "a" }] });

      await service.archiveMany("lawyer@example.com", ["a"]);

      expect(flat(pg.query.mock.calls[0][0])).not.toContain("DELETE");
      expect(s3.delete).not.toHaveBeenCalled();
    });
  });

  describe("restoreMany", () => {
    it("puts the selection back to active in a single owner-scoped statement", async () => {
      pg.query.mockResolvedValue({ rows: [{ id: "a" }] });

      await service.restoreMany("lawyer@example.com", ["a"]);

      expect(pg.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pg.query.mock.calls[0];
      expect(flat(sql)).toContain("SET lifecycle_state = 'active'");
      expect(flat(sql)).toContain("WHERE d.id = ANY($1::uuid[])");
      expect(flat(sql)).toContain("AND d.owner_email = $2");
      expect(params).toEqual([["a"], "lawyer@example.com"]);
    });

    it("refuses to resurrect a superseded duplicate", async () => {
      // The one predicate this whole file exists for. Restore is the inverse of archiveMany and of
      // nothing else: a duplicate flipped back to 'active' is an empty, chunk-less row that
      // retrieval would scope in and the page-index backfill would re-index.
      pg.query.mockResolvedValue({ rows: [] });

      await service.restoreMany("lawyer@example.com", ["d-superseded"]);

      const sql = flat(pg.query.mock.calls[0][0]);
      expect(sql).toContain("AND d.lifecycle_state = 'archived'");
      // `<> 'active'` or `<> 'archived'` would both sweep the duplicates along with the archive.
      expect(sql).not.toContain("lifecycle_state <>");
    });

    it("returns only the rows that moved, so replaying an undo twice changes nothing", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      expect(await service.restoreMany("lawyer@example.com", ["a"])).toEqual({
        documentIds: []
      });
    });
  });

  describe("timeline", () => {
    beforeEach(() => {
      pg.query.mockImplementation(async (sql: string) => ({
        rows: applyArchivedScope(sql, CORPUS)
      }));
    });

    it("hides archived documents by default, which is what makes archiving visible", async () => {
      // Retrieval already ignores them. Until this read did too, archiving looked like a button
      // that did nothing: the document stayed on screen.
      const ids = (await service.timeline("lawyer@example.com", "ws-1")).map(
        (d) => d.id
      );

      expect(ids).not.toContain("d-archived");
      expect(ids).toContain("d-active");
    });

    it("still returns the superseded duplicates it has always returned", async () => {
      // Not incidental: the view renders these as "doublon de …" behind its own toggle. Scoping
      // this read to lifecycle_state = 'active' would have deleted that feature invisibly.
      const ids = (await service.timeline("lawyer@example.com", "ws-1")).map(
        (d) => d.id
      );

      expect(ids).toContain("d-superseded");
    });

    it("returns the archived documents, and only those, for the archives view", async () => {
      const docs = await service.timeline("lawyer@example.com", "ws-1", "only");

      expect(docs.map((d) => d.id)).toEqual(["d-archived"]);
      expect(docs[0].lifecycleState).toBe("archived");
    });

    it("returns every lifecycle state when asked to include archived", async () => {
      const ids = (
        await service.timeline("lawyer@example.com", "ws-1", "include")
      ).map((d) => d.id);

      expect(ids).toEqual(["d-active", "d-superseded", "d-archived"]);
    });

    it("keeps its ownership check, parameters and chronological order", async () => {
      await service.timeline("lawyer@example.com", "ws-1");

      expect(workspaces.getOrFail).toHaveBeenCalledWith(
        "lawyer@example.com",
        "ws-1"
      );
      const [sql, params] = pg.query.mock.calls[0];
      expect(params).toEqual(["ws-1", "lawyer@example.com"]);
      // NULLS LAST is how undated documents stay reachable instead of being dropped.
      expect(flat(sql)).toContain(
        "ORDER BY timeline_date ASC NULLS LAST, created_at ASC"
      );
    });
  });

  describe("list", () => {
    beforeEach(() => {
      pg.query.mockImplementation(async (sql: string) => ({
        rows: applyArchivedScope(sql, CORPUS)
      }));
    });

    it("hides archived documents by default", async () => {
      // The chat's documents panel reads this endpoint and offers every row as pinnable; a pin on an
      // archived document retrieves nothing, because RagService's pinned paths are scoped to
      // 'active'. Listing one is offering a dead control.
      const ids = (await service.list("lawyer@example.com", "ws-1")).map(
        (d) => d.id
      );

      expect(ids).toEqual(["d-active", "d-superseded"]);
    });

    it("combines the status filter and the archived scope without disturbing the parameters", async () => {
      await service.list("lawyer@example.com", "ws-1", "duplicate", "only");

      const [sql, params] = pg.query.mock.calls[0];
      expect(flat(sql)).toContain("AND parse_status = $3");
      expect(flat(sql)).toContain("AND lifecycle_state = 'archived'");
      expect(params).toEqual(["ws-1", "lawyer@example.com", "duplicate"]);
    });
  });

  describe("side effects of an archived document", () => {
    it("is not re-summarized by the account-wide refresh", async () => {
      // resummarizeAll is a paid model call per document. Spending it on a document the user has
      // taken out of the case file buys a summary nothing will ever retrieve.
      pg.query.mockResolvedValue({ rows: [] });

      await service.resummarizeAll("lawyer@example.com");

      expect(flat(pg.query.mock.calls[0][0])).toContain(
        "AND d.lifecycle_state <> 'archived'"
      );
    });

    it("stays archived when its ingestion is retried", async () => {
      // retry resets lifecycle_state to 'active' so that re-ingesting a document ruled a duplicate
      // un-supersedes it. Applied unconditionally, that same reset silently returns an archived
      // document to search — an un-archive nobody asked for, triggered by a button about parsing.
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      pg.query.mockResolvedValue({
        rows: [docRow({ id: "d-archived", lifecycle_state: "archived" })]
      });
      pg.withTransaction.mockImplementation(
        async (fn: (c: unknown) => Promise<unknown>) => fn(client)
      );

      await service.retry("lawyer@example.com", "d-archived");

      const sql = flat(client.query.mock.calls[0][0]);
      expect(sql).toContain("CASE WHEN lifecycle_state = 'archived'");
      expect(sql).toContain("THEN 'archived' ELSE 'active' END");
      // The duplicate case must keep working: a superseded row still comes back as active.
      expect(sql).toContain("duplicate_of = NULL");
    });
  });
});
