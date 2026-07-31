import type { LexS3Service } from "../../../shared/lex-s3.service";
import type { PgService } from "../../../shared/pg.service";
import type { WorkspacesService } from "../../workspaces/workspaces.service";
import { DocumentsService } from "../documents.service";

/**
 * The page-index backfill is one bulk INSERT ... SELECT and one aggregate SELECT. Everything that
 * decides whether it is safe lives in SQL that tsc cannot see: which documents it touches, whether
 * a second click doubles the queue, and — in a corpus holding several lawyers' court files — whose
 * documents it touches at all. Those predicates are asserted here against a stubbed PgService,
 * alongside the count mapping the Settings page reads.
 *
 * A stub cannot execute SQL, so a filter is asserted by proving the conjunct is part of the
 * statement the service sends; the returned counts are asserted as real behaviour.
 */

/** The statements are multi-line, so predicates are matched against a single-space form. */
const flat = (sql: string): string => sql.replace(/\s+/g, " ");

const countsRow = (over: Record<string, number> = {}) => ({
  // Deliberately all-distinct so a mis-wired field (pending read into blocked, say) cannot pass.
  total: 9,
  indexed: 4,
  pending: 3,
  blocked: 2,
  queued: 5,
  ...over
});

const blockedRow = (over: Record<string, string> = {}) => ({
  id: "doc-1",
  filename: "Dagvaarding.pdf",
  page_index_error: "Scanned document: a paid re-ingest with OCR is required",
  ...over
});

describe("DocumentsService page index backfill", () => {
  let pg: { query: jest.Mock; withTransaction: jest.Mock };
  let workspaces: { getOrFail: jest.Mock };
  let service: DocumentsService;

  beforeEach(() => {
    pg = { query: jest.fn(), withTransaction: jest.fn() };
    workspaces = { getOrFail: jest.fn().mockResolvedValue({ id: "ws-1" }) };
    service = new DocumentsService(
      pg as unknown as PgService,
      // Neither method under test uploads or reads bytes.
      {} as never as LexS3Service,
      workspaces as unknown as WorkspacesService
    );
  });

  describe("buildPageIndexAll", () => {
    it("enqueues the 'pages' mode, in one statement, with the caller as the only parameter", async () => {
      pg.query.mockResolvedValue({ rows: [{ id: "job-1" }] });

      await service.buildPageIndexAll("lawyer@example.com");

      expect(pg.query).toHaveBeenCalledTimes(1);
      expect(pg.withTransaction).not.toHaveBeenCalled();
      const [sql, params] = pg.query.mock.calls[0];
      expect(flat(sql)).toContain(
        "INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)"
      );
      // 'full' or 'reindex' here would re-embed and re-summarize 56 documents at a cost.
      expect(flat(sql)).toContain("SELECT d.id, d.workspace_id, 'pages'");
      expect(params).toEqual(["lawyer@example.com"]);
    });

    it("never enqueues another lawyer's documents", async () => {
      // Multi-tenant corpus: without the owner predicate this one click backfills — and bills S3
      // reads for — every case file in the database.
      pg.query.mockResolvedValue({ rows: [] });

      await service.buildPageIndexAll("lawyer@example.com");

      const [sql, params] = pg.query.mock.calls[0];
      expect(flat(sql)).toContain("WHERE d.owner_email = $1");
      expect(params).toEqual(["lawyer@example.com"]);
      expect(params).toHaveLength(1);
    });

    it("targets only ready, active, un-indexed documents", async () => {
      // A document mid-ingest has no chunks to verify the re-derived text against; a superseded
      // duplicate must not become page-routable; and one already indexed is pure wasted S3 work.
      pg.query.mockResolvedValue({ rows: [] });

      await service.buildPageIndexAll("lawyer@example.com");

      const sql = flat(pg.query.mock.calls[0][0]);
      expect(sql).toContain("AND d.parse_status = 'ready'");
      expect(sql).toContain("AND d.lifecycle_state = 'active'");
      expect(sql).toContain("AND d.page_index_version = 0");
    });

    it("guards against a document that already has a job in flight, in any mode", async () => {
      // The repeated-click case. Also the race: a queued 'full' rebuilds the page rows itself, so a
      // 'pages' job running beside it would index text the other job is still replacing.
      pg.query.mockResolvedValue({ rows: [] });

      await service.buildPageIndexAll("lawyer@example.com");

      const sql = flat(pg.query.mock.calls[0][0]);
      expect(sql).toContain("AND NOT EXISTS (");
      expect(sql).toContain("SELECT 1 FROM lex_ingestion_jobs j");
      expect(sql).toContain("WHERE j.document_id = d.id");
      expect(sql).toContain("j.status IN ('queued', 'running')");
      // Any mode counts, so the subquery must not narrow itself to 'pages'.
      expect(sql).not.toContain("j.mode = 'pages'");
    });

    it("counts the rows the INSERT actually created, not the documents it looked at", async () => {
      pg.query.mockResolvedValue({
        rows: [{ id: "job-1" }, { id: "job-2" }, { id: "job-3" }]
      });

      expect(await service.buildPageIndexAll("lawyer@example.com")).toEqual({
        queued: 3
      });
      expect(flat(pg.query.mock.calls[0][0])).toContain("RETURNING id");
    });

    it("reports zero when the guard filtered everything out, so the UI can say 'nothing to do'", async () => {
      pg.query.mockResolvedValue({ rows: [] });

      expect(await service.buildPageIndexAll("lawyer@example.com")).toEqual({
        queued: 0
      });
    });
  });

  describe("pageIndexStatus", () => {
    it("maps every count to its own field and keeps the three buckets summing to total", async () => {
      pg.query
        .mockResolvedValueOnce({ rows: [countsRow()] })
        .mockResolvedValueOnce({
          rows: [
            blockedRow(),
            blockedRow({ id: "doc-2", filename: "Annexe 3.pdf" })
          ]
        });

      const status = await service.pageIndexStatus("lawyer@example.com");

      expect(status).toEqual({
        total: 9,
        indexed: 4,
        pending: 3,
        blocked: 2,
        queued: 5,
        blockedDocuments: [
          {
            documentId: "doc-1",
            filename: "Dagvaarding.pdf",
            error: "Scanned document: a paid re-ingest with OCR is required"
          },
          {
            documentId: "doc-2",
            filename: "Annexe 3.pdf",
            error: "Scanned document: a paid re-ingest with OCR is required"
          }
        ],
        blockedTruncated: false
      });
      // The invariant the progress bar is drawn from.
      expect(status.indexed + status.pending + status.blocked).toBe(
        status.total
      );
    });

    it("scopes both reads to the caller", async () => {
      // The readout is account-wide, so owner_email is the ONLY thing standing between one
      // practitioner's corpus and another's. There is no workspace lookup to lean on here.
      pg.query
        .mockResolvedValueOnce({ rows: [countsRow()] })
        .mockResolvedValueOnce({ rows: [blockedRow(), blockedRow()] });

      await service.pageIndexStatus("lawyer@example.com");

      const [countsSql, countsParams] = pg.query.mock.calls[0];
      expect(flat(countsSql)).toContain("WHERE d.owner_email = $1");
      expect(countsParams).toEqual(["lawyer@example.com"]);

      const [blockedSql, blockedParams] = pg.query.mock.calls[1];
      expect(flat(blockedSql)).toContain("WHERE d.owner_email = $1");
      expect(blockedParams[0]).toBe("lawyer@example.com");
    });

    it("counts over the same ready+active population the backfill targets", async () => {
      // Otherwise a workspace full of failed uploads sits permanently at "pending", and the user
      // waits for a backfill that will never touch them.
      pg.query.mockResolvedValueOnce({ rows: [countsRow({ blocked: 0 })] });

      await service.pageIndexStatus("lawyer@example.com");

      const sql = flat(pg.query.mock.calls[0][0]);
      expect(sql).toContain("AND d.parse_status = 'ready'");
      expect(sql).toContain("AND d.lifecycle_state = 'active'");
      expect(sql).toContain("FILTER (WHERE d.page_index_version > 0)");
      expect(sql).toContain(
        "WHERE d.page_index_version = 0 AND d.page_index_error IS NULL"
      );
      expect(sql).toContain(
        "WHERE d.page_index_version = 0 AND d.page_index_error IS NOT NULL"
      );
    });

    it("counts only 'pages' jobs as in flight", async () => {
      // A queued 'resummarize' is not evidence that the page-index backfill is progressing.
      pg.query.mockResolvedValueOnce({ rows: [countsRow({ blocked: 0 })] });

      await service.pageIndexStatus("lawyer@example.com");

      const sql = flat(pg.query.mock.calls[0][0]);
      expect(sql).toContain("j.mode = 'pages'");
      expect(sql).toContain("j.status IN ('queued', 'running')");
    });

    it("skips the second query entirely when nothing is blocked", async () => {
      // This endpoint is polled for the length of a backfill; the healthy case stays one query.
      pg.query.mockResolvedValueOnce({ rows: [countsRow({ blocked: 0 })] });

      const status = await service.pageIndexStatus("lawyer@example.com");

      expect(pg.query).toHaveBeenCalledTimes(1);
      expect(status.blockedDocuments).toEqual([]);
      expect(status.blockedTruncated).toBe(false);
    });

    it("caps the named blocked documents and admits the list is partial", async () => {
      // A bundle of 120 scans must not return 120 rows on every poll — but the user has to be told
      // the list they are reconciling against their folder is not the whole story.
      pg.query
        .mockResolvedValueOnce({ rows: [countsRow({ blocked: 120 })] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 50 }, (_, i) =>
            blockedRow({ id: `doc-${i}`, filename: `Scan ${i}.pdf` })
          )
        });

      const status = await service.pageIndexStatus("lawyer@example.com");

      expect(status.blocked).toBe(120);
      expect(status.blockedDocuments).toHaveLength(50);
      expect(status.blockedTruncated).toBe(true);
      const [sql, params] = pg.query.mock.calls[1];
      expect(flat(sql)).toContain("LIMIT $3");
      expect(params[2]).toBe(50);
    });

    it("has the database truncate page_index_error, which has no length limit", async () => {
      pg.query
        .mockResolvedValueOnce({ rows: [countsRow({ blocked: 1 })] })
        .mockResolvedValueOnce({ rows: [blockedRow()] });

      await service.pageIndexStatus("lawyer@example.com");

      const [sql, params] = pg.query.mock.calls[1];
      expect(flat(sql)).toContain("left(d.page_index_error, $2)");
      expect(params[1]).toBe(400);
    });

    it("orders the blocked list by filename, because the cap decides what is seen", async () => {
      pg.query
        .mockResolvedValueOnce({ rows: [countsRow({ blocked: 1 })] })
        .mockResolvedValueOnce({ rows: [blockedRow()] });

      await service.pageIndexStatus("lawyer@example.com");

      expect(flat(pg.query.mock.calls[1][0])).toContain(
        "ORDER BY d.filename ASC"
      );
    });
  });
});
