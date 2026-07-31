import { Logger } from "@nestjs/common";
import * as XLSX from "xlsx";
import type { ConfigService } from "../../../config/config.service";
import type { LexS3Service } from "../../../shared/lex-s3.service";
import type { OpenAiService } from "../../../shared/openai.service";
import type { PgService } from "../../../shared/pg.service";
import type { SettingsService } from "../../settings/settings.service";
import { buildFullText, chunkText } from "../chunker";
import { parseDocument } from "../document-parser";
import { IngestionWorker } from "../ingestion.worker";
import type { MistralOcrService } from "../mistral-ocr.service";
import { pageTextHash } from "../pager";

// The 'pages' job mode builds the per-page index of a document that is ALREADY indexed, and its
// whole contract is made of things tsc cannot see: that it spends nothing (no OCR, no transcription,
// no embedding), that it writes page rows ONLY when the text it re-derives today still matches the
// text the chunks were built from, and that a rebuild does not silently unanchor the citations its
// DELETE nulls on the way through. Each of those is asserted here against a fake PgService that
// models the two cross-table rules the SQL leans on (see fakeDb).
//
// Fixtures are real bytes through the REAL parser rather than a stubbed parseDocument, both because
// parseDocument is a module-level import with no injectable seam and because the element split under
// test is the parser's own — the one thing a fake would paper over. A multi-page PDF is deliberately
// not among them: unpdf's pdfjs is ESM-only and unavailable under Jest, which is why
// document-parser.spec.ts also tests PDF *routing* only. The two shapes that do run cover what the
// worker itself decides — a multi-element document (workbook: sheets) and a single blob (transcript,
// txt: sections) — and pager.spec.ts owns the "p. n" labelling of genuine pages.

/** A statement the worker issued, and whether it ran inside pg.withTransaction. */
interface Statement {
  tag: string;
  sql: string;
  params: unknown[];
  inTx: boolean;
}

interface DocRowShape {
  id: string;
  workspace_id: string;
  owner_email: string;
  filename: string;
  content_type: string | null;
  s3_key: string;
  transcript: string | null;
}

interface ChunkRowShape {
  chunk_index: number;
  content: string;
  char_start: number | null;
  char_end: number | null;
}

/** lex_document_pages, as the re-anchor join reads it back. */
interface StoredPage {
  id: string;
  ordinal: number;
  page_number: number | null;
  page_label: string;
  page_origin: string;
  char_start: number;
  char_end: number;
  text: string;
  char_count: number;
  token_count: number;
  text_fingerprint: string | null;
  continues_into_next: boolean;
}

/** Only the three columns of lex_citations a page anchor lives in. */
interface StoredCitation {
  id: string;
  page_id: string | null;
  page_ordinal: number | null;
  page_text_hash: string | null;
}

const DOC_ID = "doc-1";

/**
 * Names each statement by intent, so a test can assert the WHOLE sequence the worker issued — which
 * is how "nothing else about the document is mutated" gets checked. Anything unrecognised is tagged
 * UNEXPECTED with its own text, so a newly introduced write lands in the diff instead of being
 * silently tolerated.
 */
function tagOf(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  if (/^SELECT .* FROM lex_documents WHERE id = \$1/.test(flat))
    return "select:document";
  if (/^SELECT .* FROM lex_document_chunks/.test(flat)) return "select:chunks";
  if (/^DELETE FROM lex_document_pages/.test(flat)) return "delete:pages";
  if (/^INSERT INTO lex_document_pages/.test(flat)) return "insert:page";
  if (/^UPDATE lex_citations/.test(flat)) return "reanchor:citations";
  if (/^UPDATE lex_documents SET page_index_version/.test(flat))
    return "update:pageIndexVersion";
  if (/^UPDATE lex_documents SET page_index_error/.test(flat))
    return "update:pageIndexError";
  if (/^UPDATE lex_ingestion_jobs SET status = 'running'/.test(flat))
    return "job:claim";
  if (/^UPDATE lex_ingestion_jobs SET status = 'done'/.test(flat))
    return "job:done";
  if (/^UPDATE lex_ingestion_jobs SET status = 'failed'/.test(flat))
    return "job:failed";
  return `UNEXPECTED: ${flat.slice(0, 120)}`;
}

/**
 * A fake PgService that keeps lex_document_pages and lex_citations in memory.
 *
 * It models the two rules the rebuild's correctness rests on, neither of which is visible in any
 * single SQL string:
 *  - lex_citations.page_id is ON DELETE SET NULL, so DELETE FROM lex_document_pages unanchors every
 *    page-anchored citation of the document (migration 1754000000000_lex-document-pages.js:91-92).
 *  - the re-anchor UPDATE joins (page_ordinal, page_text_hash) against the freshly written rows and
 *    only touches citations whose page_id is currently NULL.
 * A rebuild hands out FRESH page ids exactly as the real INSERT does, which is why re-anchoring is
 * needed at all and how a test tells a re-pointed citation from an untouched one.
 */
function fakeDb(initial: {
  doc: DocRowShape | null;
  chunks?: ChunkRowShape[];
  job?: { id: string; document_id: string; mode: string } | null;
}) {
  const db = {
    doc: initial.doc,
    chunks: initial.chunks ?? [],
    job: initial.job ?? null,
    pages: [] as StoredPage[],
    citations: [] as StoredCitation[],
    pageIndexVersion: 0,
    pageIndexError: null as string | null,
    jobStatus: null as string | null,
    statements: [] as Statement[],
    builds: 0,
    tags(): string[] {
      return db.statements.map((s) => s.tag);
    },
    withTag(tag: string): Statement[] {
      return db.statements.filter((s) => s.tag === tag);
    },
    run(sql: string, params: unknown[] = [], inTx = false) {
      const tag = tagOf(sql);
      db.statements.push({ tag, sql, params, inTx });
      switch (tag) {
        case "select:document":
          return { rows: db.doc ? [db.doc] : [] };
        case "select:chunks":
          return { rows: db.chunks };
        case "delete:pages": {
          const removed = new Set(db.pages.map((p) => p.id));
          db.pages = [];
          for (const c of db.citations) {
            if (c.page_id && removed.has(c.page_id)) c.page_id = null;
          }
          db.builds += 1;
          return { rows: [] };
        }
        case "insert:page": {
          const p = params as [
            string,
            string,
            string,
            number,
            number | null,
            string,
            string,
            number,
            number,
            string,
            number,
            number,
            string | null,
            boolean
          ];
          db.pages.push({
            id: `page-build${db.builds}-ord${p[3]}`,
            ordinal: p[3],
            page_number: p[4],
            page_label: p[5],
            page_origin: p[6],
            char_start: p[7],
            char_end: p[8],
            text: p[9],
            char_count: p[10],
            token_count: p[11],
            text_fingerprint: p[12],
            continues_into_next: p[13]
          });
          return { rows: [] };
        }
        case "reanchor:citations": {
          const ordinals = params[1] as number[];
          const hashes = params[2] as (string | null)[];
          for (const c of db.citations) {
            if (c.page_id !== null || c.page_ordinal === null) continue;
            const at = ordinals.findIndex(
              (ordinal, i) =>
                ordinal === c.page_ordinal && hashes[i] === c.page_text_hash
            );
            if (at === -1) continue;
            c.page_id =
              db.pages.find((p) => p.ordinal === ordinals[at])?.id ?? null;
          }
          return { rows: [] };
        }
        case "update:pageIndexVersion":
          db.pageIndexVersion = 1;
          db.pageIndexError = null;
          return { rows: [] };
        case "update:pageIndexError":
          db.pageIndexError = params[1] as string;
          return { rows: [] };
        case "job:claim":
          return { rows: db.job ? [db.job] : [] };
        case "job:done":
          db.jobStatus = "done";
          return { rows: [] };
        case "job:failed":
          db.jobStatus = "failed";
          return { rows: [] };
        default:
          return { rows: [] };
      }
    },
    query: (sql: string, params?: unknown[]) =>
      Promise.resolve(db.run(sql, params, false)),
    withTransaction: <T>(fn: (client: unknown) => Promise<T>) =>
      fn({
        query: (sql: string, params?: unknown[]) =>
          Promise.resolve(db.run(sql, params, true))
      })
  };
  return db;
}

/** A real .xlsx — the "Décompte" every bundle contains, and a genuine multi-element document. */
function workbook(sheets: { name: string; rows: (string | number)[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sheet.rows),
      sheet.name
    );
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const SHEETS_V1 = [
  {
    name: "Facturen",
    rows: [
      ["nr", "montant"],
      ["F-2023-01", 1500]
    ]
  },
  { name: "Saldi", rows: [["solde", 1500]] },
  {
    name: "Paiements",
    rows: [
      ["date", "montant"],
      ["2023-04-12", 0]
    ]
  }
];
/** The same workbook re-exported with the Saldi sheet corrected. Facturen/Paiements are identical. */
const SHEETS_V2 = [
  SHEETS_V1[0],
  { name: "Saldi", rows: [["solde", 250]] },
  SHEETS_V1[2]
];
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Conclusions long enough to be cut into several sections — a real filing is far longer. */
const CONCLUSIONS = Array.from(
  { length: 14 },
  (_, i) =>
    `${i + 1}. Point de droit numero ${i + 1}.\n` +
    "La creance est etablie par les pieces du dossier. ".repeat(10)
).join("\n\n");

const TRANSCRIPT =
  "Note vocale du 4 mai. Le client confirme avoir paye la facture en especes, " +
  "sans recu. Il faut demander l'extrait de compte a la banque.";

/** The 8-byte PNG signature — all the parser needs to route by bytes and demand OCR. */
const PNG_SCAN = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d
]);

/**
 * Reproduces the chunk rows an earlier 'full' ingest of these bytes would have stored: the real
 * parser, the real buildFullText, the real chunker. Going through the production path rather than
 * hand-writing rows is the point — the verify step's whole claim is that these chunks are an exact
 * witness to the fullText they were offset against.
 */
async function indexedChunks(
  body: Buffer,
  contentType: string,
  filename: string
): Promise<ChunkRowShape[]> {
  const { fullText, pageRanges } = await derived(body, contentType, filename);
  return chunkText(fullText, pageRanges).map((c) => ({
    chunk_index: c.chunkIndex,
    content: c.content,
    char_start: c.charStart,
    char_end: c.charEnd
  }));
}

/** The fullText the worker must re-derive, for round-trip assertions on the page rows. */
async function derived(body: Buffer, contentType: string, filename: string) {
  const parsed = await parseDocument(body, contentType, filename);
  return buildFullText(parsed.pages);
}

/** The comparable content of a page row: everything except the id the rebuild regenerates. */
function payload(page: StoredPage) {
  const { id, ...rest } = page;
  void id;
  return rest;
}

function docRow(over: Partial<DocRowShape> = {}): DocRowShape {
  return {
    id: DOC_ID,
    workspace_id: "ws-1",
    owner_email: "lawyer@example.com",
    filename: "Conclusions.txt",
    content_type: "text/plain",
    s3_key: "lex/ws-1/conclusions.txt",
    transcript: null,
    ...over
  };
}

function workbookDoc(): DocRowShape {
  return docRow({
    filename: "Décompte.xlsx",
    content_type: XLSX_MIME,
    s3_key: "lex/ws-1/decompte.xlsx"
  });
}

describe("IngestionWorker — 'pages' backfill mode", () => {
  let db: ReturnType<typeof fakeDb>;
  let openai: { embed: jest.Mock; complete: jest.Mock; transcribe: jest.Mock };
  let s3: { get: jest.Mock };
  let ocr: { isConfigured: jest.Mock; ocr: jest.Mock };
  let settings: { languageOf: jest.Mock };
  let logged: Record<string, unknown>[];
  let warned: Record<string, unknown>[];

  // Restated because JobMode is a non-exported local type in the worker.
  type Modes = "full" | "reindex" | "resummarize" | "pages";
  let worker: {
    runPipeline(documentId: string, mode: Modes): Promise<void>;
    processOne(): Promise<boolean>;
  };

  function build(initial: Parameters<typeof fakeDb>[0]) {
    db = fakeDb(initial);
    worker = new IngestionWorker(
      db as unknown as PgService,
      openai as unknown as OpenAiService,
      s3 as unknown as LexS3Service,
      ocr as unknown as MistralOcrService,
      settings as unknown as SettingsService,
      {} as unknown as ConfigService
    ) as unknown as typeof worker;
    return db;
  }

  beforeEach(() => {
    openai = { embed: jest.fn(), complete: jest.fn(), transcribe: jest.fn() };
    s3 = { get: jest.fn() };
    ocr = { isConfigured: jest.fn(() => true), ocr: jest.fn() };
    settings = { languageOf: jest.fn() };
    logged = [];
    warned = [];
    jest.spyOn(Logger.prototype, "log").mockImplementation((message) => {
      logged.push(JSON.parse(String(message)));
    });
    jest.spyOn(Logger.prototype, "warn").mockImplementation((message) => {
      warned.push(JSON.parse(String(message)));
    });
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes exact, finer-grained page rows for a document that still matches its chunks", async () => {
    const body = Buffer.from(CONCLUSIONS, "utf8");
    s3.get.mockResolvedValue({ body });
    const chunks = await indexedChunks(body, "text/plain", "Conclusions.txt");
    build({ doc: docRow(), chunks });

    await worker.runPipeline(DOC_ID, "pages");

    const { fullText } = await derived(body, "text/plain", "Conclusions.txt");
    // The invariant every page-anchored citation resolves through. Approximate rows are exactly
    // what this mode refuses to write, so this is the assertion that says these are exact.
    expect(db.pages.length).toBeGreaterThan(1);
    for (const p of db.pages) {
      expect(fullText.slice(p.char_start, p.char_end)).toBe(p.text);
      expect(p.char_count).toBe(p.text.length);
    }
    // Nothing dropped, nothing duplicated: the rows tile the whole indexed text.
    expect(db.pages.map((p) => p.text).join("")).toBe(fullText);
    expect(db.pages.map((p) => p.ordinal)).toEqual([1, 2, 3]);

    // The gap being closed: on a blob-format document every chunk carries pageFrom = pageTo = 1, so
    // a pin used to hand the model the entire filing. Each row is now an addressable fraction of it.
    expect(db.pages[0].char_count).toBeLessThan(fullText.length / 2);

    expect(db.pageIndexVersion).toBe(1);
    expect(db.pageIndexError).toBeNull();
    expect(logged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "lexPageIndexBackfilled",
          documentId: DOC_ID,
          filename: "Conclusions.txt",
          chunksVerified: chunks.length
        })
      ])
    );
  });

  it("mutates nothing about the document except the page index, and pays for nothing", async () => {
    const body = workbook(SHEETS_V1);
    s3.get.mockResolvedValue({ body });
    const chunks = await indexedChunks(body, XLSX_MIME, "Décompte.xlsx");
    build({ doc: workbookDoc(), chunks });

    await worker.runPipeline(DOC_ID, "pages");

    // The gap being closed, at its starkest: this workbook is ONE chunk spanning all three sheets,
    // so pinning "Saldi" handed the model all of them under the label of the first. Three rows now.
    expect(chunks).toHaveLength(1);
    expect(db.pages).toHaveLength(3);

    // The complete list of statements issued. A parse_status update, a chunk DELETE/INSERT, an
    // lex_case_state touch or anything else unforeseen all surface right here.
    expect(db.tags()).toEqual([
      "select:document",
      "select:chunks",
      "delete:pages",
      "insert:page",
      "insert:page",
      "insert:page",
      "reanchor:citations",
      "update:pageIndexVersion"
    ]);
    // The DELETE unanchors citations, so a crash before the last INSERT would leave a half index,
    // unanchored citations, and page_index_version still claiming the state it had before. Every
    // write of the rebuild therefore has to be in ONE transaction.
    expect(
      db.statements
        .filter((s) => s.tag !== "select:document" && s.tag !== "select:chunks")
        .every((s) => s.inTx)
    ).toBe(true);

    // "No paid API call of any kind" is why this mode exists, and why the backfill can be run over
    // the whole corpus without asking anyone's permission first.
    expect(openai.embed).not.toHaveBeenCalled();
    expect(openai.complete).not.toHaveBeenCalled();
    expect(openai.transcribe).not.toHaveBeenCalled();
    expect(ocr.ocr).not.toHaveBeenCalled();
    // The summary is not rewritten, so the owner's pinned language is never even consulted.
    expect(settings.languageOf).not.toHaveBeenCalled();

    // A spreadsheet has sheets, not pages, and the kind is threaded from the parser rather than
    // assumed: "p. 2" would be a lie the citation then repeats in a filing.
    expect(db.pages.map((p) => p.page_origin)).toEqual([
      "sheet",
      "sheet",
      "sheet"
    ]);
    expect(db.pages.map((p) => p.page_label)).toEqual([
      "sheet: Facturen",
      "sheet: Saldi",
      "sheet: Paiements"
    ]);
    expect(db.pages.every((p) => p.page_number === null)).toBe(true);
  });

  // THE citation-integrity guarantee. Page rows are nothing but offsets into a fullText: if the text
  // read today differs from the text the chunks were built against, the same quote resolves to
  // different source through the page grain than through the chunk grain — and which one answers
  // depends only on whether the document happened to be pinned.
  it("writes NO page rows and records the reason when today's text no longer matches the chunks", async () => {
    // The workbook was re-exported with the Saldi sheet corrected; its chunks are still v1's.
    s3.get.mockResolvedValue({ body: workbook(SHEETS_V2) });
    build({
      doc: workbookDoc(),
      chunks: await indexedChunks(
        workbook(SHEETS_V1),
        XLSX_MIME,
        "Décompte.xlsx"
      )
    });

    await worker.runPipeline(DOC_ID, "pages");

    expect(db.pages).toEqual([]);
    expect(db.withTag("insert:page")).toHaveLength(0);
    // Not even the DELETE ran, so a document that HAS a good page index cannot lose it this way.
    expect(db.withTag("delete:pages")).toHaveLength(0);
    expect(db.tags()).toEqual([
      "select:document",
      "select:chunks",
      "update:pageIndexError"
    ]);
    expect(db.pageIndexVersion).toBe(0);
    expect(db.pageIndexError).toContain("Décompte.xlsx");
    expect(db.pageIndexError).toMatch(/no longer matches/i);
    expect(warned).toEqual([
      expect.objectContaining({
        action: "lexPageIndexSkipped",
        documentId: DOC_ID,
        detail: expect.stringMatching(/chunk \d+ does not round-trip/)
      })
    ]);
  });

  // char_start / char_end are nullable columns, and a span that cannot be checked has not been
  // verified. Reading "unverifiable" as "verified" would write page rows against unwitnessed text.
  it("refuses a document whose stored chunks carry NULL offsets", async () => {
    const body = workbook(SHEETS_V1);
    s3.get.mockResolvedValue({ body });
    // The workbook is ONE chunk covering the whole text, so a lenient check that coalesced the
    // NULL to 0 would round-trip and wave the document through. There is no second chunk to
    // stumble on: this document is only refused if a NULL is itself treated as unverified.
    const chunks = await indexedChunks(body, XLSX_MIME, "Décompte.xlsx");
    build({
      doc: workbookDoc(),
      chunks: chunks.map((c) => ({ ...c, char_start: null }))
    });

    await worker.runPipeline(DOC_ID, "pages");

    expect(db.pages).toEqual([]);
    expect(db.pageIndexVersion).toBe(0);
    expect(db.pageIndexError).toMatch(/no longer matches/i);
  });

  it("stops on a document with zero chunks, having nothing to verify the text against", async () => {
    s3.get.mockResolvedValue({ body: Buffer.from(CONCLUSIONS, "utf8") });
    build({ doc: docRow(), chunks: [] });

    await worker.runPipeline(DOC_ID, "pages");

    expect(db.pages).toEqual([]);
    expect(db.withTag("insert:page")).toHaveLength(0);
    expect(db.pageIndexVersion).toBe(0);
    // A document set aside as a duplicate is the ordinary shape of this case, and the message says
    // so rather than reading like a defect.
    expect(db.pageIndexError).toMatch(/no indexed text/i);
  });

  // The promise of this mode is "free". OCR is a paid call AND non-deterministic, so a second pass
  // could not reproduce the text the chunks were built from and would fail the verify step anyway —
  // paying for it would buy a guaranteed stop.
  it("stops on a scan WITHOUT calling the OCR service at all", async () => {
    s3.get.mockResolvedValue({ body: PNG_SCAN });
    build({
      doc: docRow({ filename: "Annexe 3.png", content_type: "image/png" }),
      chunks: []
    });

    await worker.runPipeline(DOC_ID, "pages");

    expect(ocr.ocr).not.toHaveBeenCalled();
    expect(ocr.isConfigured).not.toHaveBeenCalled();
    expect(openai.transcribe).not.toHaveBeenCalled();
    expect(db.pages).toEqual([]);
    // It gives up before even reading the chunks: the parser's verdict alone decides the refusal.
    expect(db.tags()).toEqual(["select:document", "update:pageIndexError"]);
    expect(db.pageIndexError).toContain("Annexe 3.png");
    expect(db.pageIndexError).toMatch(/scan/i);
  });

  // A stop is an OUTCOME, not a crash. Were it to throw, processOne would set parse_status =
  // 'failed', dropping a document that is currently answering questions out of every retrieval
  // path — over an index it does not have today.
  it("completes the job and leaves parse_status alone when it stops", async () => {
    s3.get.mockResolvedValue({ body: PNG_SCAN });
    build({
      doc: docRow({ filename: "Annexe 3.png", content_type: "image/png" }),
      chunks: [],
      job: { id: "job-1", document_id: DOC_ID, mode: "pages" }
    });

    await expect(worker.processOne()).resolves.toBe(true);

    expect(db.jobStatus).toBe("done");
    expect(db.tags()).not.toContain("job:failed");
    expect(db.statements.some((s) => /parse_status/.test(s.sql))).toBe(false);
  });

  it("backfills a voice note from its stored transcript, without transcribing or reading S3", async () => {
    const { fullText, pageRanges } = buildFullText([TRANSCRIPT]);
    build({
      doc: docRow({
        filename: "note-vocale.m4a",
        content_type: "audio/m4a",
        s3_key: "lex/ws-1/note-vocale.m4a",
        transcript: TRANSCRIPT
      }),
      chunks: chunkText(fullText, pageRanges).map((c) => ({
        chunk_index: c.chunkIndex,
        content: c.content,
        char_start: c.charStart,
        char_end: c.charEnd
      }))
    });

    await worker.runPipeline(DOC_ID, "pages");

    expect(openai.transcribe).not.toHaveBeenCalled();
    // Not even an S3 GET: the indexed text IS the stored transcript, hand-corrections included.
    expect(s3.get).not.toHaveBeenCalled();
    expect(db.pages).toHaveLength(1);
    expect(db.pages[0].text).toBe(fullText);
    // Speech has no pages. "p. 1" would be a lie a citation then repeats in a filing.
    expect(db.pages[0].page_number).toBeNull();
    expect(db.pages[0].page_origin).toBe("section");
    expect(db.pages[0].page_label).toBe("whole document");
    expect(db.pageIndexVersion).toBe(1);
    expect(db.pageIndexError).toBeNull();
  });

  // The backfill enqueues every ready document and is re-runnable, so it has to be safe on a
  // document that already has a page index.
  it("is idempotent: a second run reproduces the same page rows", async () => {
    const body = workbook(SHEETS_V1);
    s3.get.mockResolvedValue({ body });
    build({
      doc: workbookDoc(),
      chunks: await indexedChunks(body, XLSX_MIME, "Décompte.xlsx")
    });

    await worker.runPipeline(DOC_ID, "pages");
    const first = db.pages.map(payload);

    await worker.runPipeline(DOC_ID, "pages");

    expect(db.pages.map(payload)).toEqual(first);
    expect(db.pages).toHaveLength(3);
    expect(db.withTag("insert:page")).toHaveLength(6); // three rows, written twice
    expect(db.pageIndexVersion).toBe(1);
    expect(db.pageIndexError).toBeNull();
  });

  // The DELETE nulls every page anchor on its way through (ON DELETE SET NULL), so without the
  // re-anchor a rebuild silently unanchors citations already filed in a court document. And a page
  // whose text moved must LOSE its anchor rather than keep claiming text it no longer quotes.
  it("re-anchors a citation whose page text is unchanged, and leaves one whose text changed unanchored", async () => {
    const v1 = workbook(SHEETS_V1);
    s3.get.mockResolvedValue({ body: v1 });
    build({
      doc: workbookDoc(),
      chunks: await indexedChunks(v1, XLSX_MIME, "Décompte.xlsx")
    });
    await worker.runPipeline(DOC_ID, "pages");

    // Two citations filed against v1, hashed the way a page-anchored citation writer must hash.
    const [facturen, saldi] = db.pages;
    db.citations = [
      {
        id: "cit-unchanged",
        page_id: facturen.id,
        page_ordinal: facturen.ordinal,
        page_text_hash: pageTextHash(facturen.text)
      },
      {
        id: "cit-changed",
        page_id: saldi.id,
        page_ordinal: saldi.ordinal,
        page_text_hash: pageTextHash(saldi.text)
      }
    ];

    // The workbook is re-exported with the Saldi sheet corrected and fully re-ingested, so the
    // chunks match the new text and the verify step passes.
    const v2 = workbook(SHEETS_V2);
    s3.get.mockResolvedValue({ body: v2 });
    db.chunks = await indexedChunks(v2, XLSX_MIME, "Décompte.xlsx");

    await worker.runPipeline(DOC_ID, "pages");

    const cite = (id: string) => db.citations.find((c) => c.id === id);
    // Re-pointed at the NEW row for the unchanged sheet — not merely left alone, since the id it
    // held no longer exists.
    expect(cite("cit-unchanged")?.page_id).not.toBeNull();
    expect(cite("cit-unchanged")?.page_id).not.toBe(facturen.id);
    expect(cite("cit-unchanged")?.page_id).toBe(
      db.pages.find((p) => p.ordinal === facturen.ordinal)?.id
    );
    // The Saldi sheet says something different now, so the anchor is gone and the citation falls
    // back to its char offsets instead of claiming a page it no longer quotes.
    expect(cite("cit-changed")?.page_id).toBeNull();

    // The staleness test is a hash of the EXACT text. text_fingerprint is normalised (so a page
    // that changed only in case or spacing would keep its anchor) and null under 200 chars (so a
    // short sheet could never be anchored at all) — shipping it here would be silently wrong.
    const reanchor = db.withTag("reanchor:citations").at(-1);
    expect(reanchor?.params[1]).toEqual([1, 2, 3]);
    expect(reanchor?.params[2]).toEqual(
      db.pages.map((p) => pageTextHash(p.text))
    );
    expect(reanchor?.sql).toMatch(/c\.page_id IS NULL/);
    expect(reanchor?.sql).toMatch(/c\.page_text_hash = fresh\.text_hash/);
  });

  // An unreadable S3 object or a parser throw is not a reason to break a working document over an
  // index it does not have today, so the failure is recorded on the page index and nowhere else.
  it("records a stop instead of failing the document when acquisition throws", async () => {
    s3.get.mockRejectedValue(new Error("NoSuchKey: the object is gone"));
    build({
      doc: docRow(),
      chunks: await indexedChunks(
        Buffer.from(CONCLUSIONS, "utf8"),
        "text/plain",
        "Conclusions.txt"
      )
    });

    await expect(worker.runPipeline(DOC_ID, "pages")).resolves.toBeUndefined();

    expect(db.pages).toEqual([]);
    expect(db.tags()).toEqual(["select:document", "update:pageIndexError"]);
    expect(db.pageIndexError).toMatch(/unchanged and keeps working/i);
    expect(warned).toEqual([
      expect.objectContaining({
        action: "lexPageIndexSkipped",
        detail: expect.stringContaining("NoSuchKey")
      })
    ]);
  });
});
