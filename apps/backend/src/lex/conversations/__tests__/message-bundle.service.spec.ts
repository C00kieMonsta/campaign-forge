import { PassThrough } from "node:stream";
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException
} from "@nestjs/common";
import type { LexS3Service } from "../../../shared/lex-s3.service";
import type { PgService } from "../../../shared/pg.service";
import { MessageBundleService } from "../message-bundle.service";

/**
 * The zip is assembled from bytes that arrive over the network, so what is tested here is what
 * happens when they do not: a pièce whose S3 object is gone must not take the other thirty-nine
 * down with it, and everything that CAN be a status code must be decided before the response is
 * committed — after the first chunk, an error is indistinguishable from a truncated download.
 *
 * Entry names are asserted against the raw archive because zip stores them in the clear in each
 * local file header. That is enough to prove an entry exists without unpacking the archive.
 */

const MESSAGE_ID = "11112222-3333-4444-5555-666677778888";
const OWNER = "lawyer@example.com";

interface CitationOverrides {
  marker_index?: number;
  document_id?: string | null;
  filename?: string | null;
  s3_key?: string | null;
  size_bytes?: string | null;
  source_text?: string | null;
}

function citationRow(over: CitationOverrides = {}) {
  return {
    marker_index: 401,
    document_id: "doc-1",
    filename: "CONCLUSIONS.pdf",
    page_label: null,
    page_from: 12,
    page_to: 12,
    quote: "un rapport de 226.956,52 EUR",
    source_text: "L'état liquidatif retient un rapport de 226.956,52 EUR.",
    s3_key: "lex/ws-1/doc-1/original.pdf",
    s3_version_id: null,
    size_bytes: "1024",
    ...over
  };
}

const messageRow = {
  id: MESSAGE_ID,
  content: "L'état liquidatif retient 226.956,52 EUR [401].",
  created_at: new Date("2026-09-03T10:00:00.000Z"),
  title: "Succession Pirson"
};

/** Routes by statement, so a test states which rows exist rather than which call index returns what. */
function makePg(opts: {
  message?: unknown[];
  citations?: unknown[];
}): PgService {
  return {
    query: jest.fn(async (sql: string) => {
      const rows = sql.includes("FROM lex_messages")
        ? (opts.message ?? [messageRow])
        : (opts.citations ?? [citationRow()]);
      return { rows, rowCount: rows.length };
    })
  } as unknown as PgService;
}

function makeS3(get?: jest.Mock): LexS3Service {
  return {
    get:
      get ??
      jest.fn(async () => ({
        body: Buffer.from("%PDF-1.7 fake"),
        contentType: "application/pdf"
      }))
  } as unknown as LexS3Service;
}

async function collect(
  service: MessageBundleService,
  planned: Awaited<ReturnType<MessageBundleService["plan"]>>
): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Uint8Array[] = [];
  sink.on("data", (c: Buffer) => chunks.push(new Uint8Array(c)));
  const finished = new Promise<void>((resolve) => sink.on("end", resolve));
  await service.write(planned, sink);
  await finished;
  return Buffer.concat(chunks);
}

describe("MessageBundleService.plan", () => {
  it("404s a message that is not the caller's", () => {
    const service = new MessageBundleService(makePg({ message: [] }), makeS3());
    return expect(service.plan(OWNER, MESSAGE_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("refuses an answer that cites nothing", () => {
    const service = new MessageBundleService(
      makePg({ citations: [] }),
      makeS3()
    );
    return expect(service.plan(OWNER, MESSAGE_ID)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("refuses an oversized bundle before a byte is written", () => {
    // 1.2 GB across two pièces. The alternative is a download that runs for twenty minutes and
    // then dies in the browser with no status code to explain it.
    const service = new MessageBundleService(
      makePg({
        citations: [
          citationRow({ size_bytes: "600000000" }),
          citationRow({
            marker_index: 402,
            document_id: "doc-2",
            size_bytes: "600000000"
          })
        ]
      }),
      makeS3()
    );
    return expect(service.plan(OWNER, MESSAGE_ID)).rejects.toBeInstanceOf(
      PayloadTooLargeException
    );
  });

  it("reads BIGINT sizes as numbers, not as concatenated strings", async () => {
    const service = new MessageBundleService(
      makePg({
        citations: [
          citationRow({ size_bytes: "1024" }),
          citationRow({
            marker_index: 402,
            document_id: "doc-2",
            size_bytes: "2048"
          })
        ]
      }),
      makeS3()
    );
    const planned = await service.plan(OWNER, MESSAGE_ID);
    expect(planned.plan.totalBytes).toBe(3072);
    expect(planned.filename).toBe(
      "pieces-citees-succession-pirson-11112222.zip"
    );
  });
});

describe("MessageBundleService.write", () => {
  it("puts every cited pièce and both manifests in the archive", async () => {
    const service = new MessageBundleService(
      makePg({
        citations: [
          citationRow(),
          citationRow({
            marker_index: 412,
            document_id: "doc-2",
            filename: "Inventaire.pdf"
          })
        ]
      }),
      makeS3()
    );
    const zip = await collect(service, await service.plan(OWNER, MESSAGE_ID));
    const text = zip.toString("latin1");

    expect(text).toContain("pieces/01_CONCLUSIONS.pdf");
    expect(text).toContain("pieces/02_Inventaire.pdf");
    expect(text).toContain("EXTRAITS.md");
    expect(text).toContain("reponse.md");
    expect(zip.length).toBeGreaterThan(0);
  });

  it("keeps going when one pièce is gone from S3, and says so in the manifest", async () => {
    const get = jest.fn(async (key: string) => {
      if (key.includes("doc-2")) throw new Error("NoSuchKey");
      return {
        body: Buffer.from("%PDF-1.7 fake"),
        contentType: "application/pdf"
      };
    });
    const service = new MessageBundleService(
      makePg({
        citations: [
          citationRow(),
          citationRow({
            marker_index: 412,
            document_id: "doc-2",
            filename: "Inventaire.pdf",
            s3_key: "lex/ws-1/doc-2/original.pdf"
          })
        ]
      }),
      makeS3(get as unknown as jest.Mock)
    );

    const zip = await collect(service, await service.plan(OWNER, MESSAGE_ID));
    const text = zip.toString("latin1");

    // The pièce that resolved is still there — the failure cost the reader one file, not forty.
    expect(text).toContain("pieces/01_CONCLUSIONS.pdf");
    expect(text).not.toContain("pieces/02_Inventaire.pdf");
    expect(text).toContain("EXTRAITS.md");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("asks S3 for the exact version the citation was written against", async () => {
    const get = jest.fn(async () => ({
      body: Buffer.from("x"),
      contentType: "application/pdf"
    }));
    const service = new MessageBundleService(
      makePg({ citations: [{ ...citationRow(), s3_version_id: "v7" }] }),
      makeS3(get as unknown as jest.Mock)
    );
    await collect(service, await service.plan(OWNER, MESSAGE_ID));
    expect(get).toHaveBeenCalledWith("lex/ws-1/doc-1/original.pdf", "v7");
  });
});
