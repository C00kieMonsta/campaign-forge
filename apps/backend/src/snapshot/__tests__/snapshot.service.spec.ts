import { PassThrough } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { ConflictException } from "@nestjs/common";
import { verify } from "jsonwebtoken";
import type { ConfigService } from "../../config/config.service";
import type { DdbService } from "../../shared/ddb.service";
import type { LexS3Service } from "../../shared/lex-s3.service";
import type { PgService } from "../../shared/pg.service";
import type { S3Service } from "../../shared/s3.service";
import { SNAPSHOT_DOWNLOAD_PURPOSE } from "../snapshot-archive";
import {
  DOWNLOAD_TICKET_TTL_SECONDS,
  SnapshotService
} from "../snapshot.service";

/**
 * The archive is read back entry by entry (central directory, then inflate), because what a
 * restore needs is the content: a contacts line with its string set as an array, a table dump
 * without its generated column, a manifest that names the object S3 would not return. Checking
 * that entry names appear in the raw bytes would prove none of that.
 */

const SECRET = "s".repeat(40);
const TABLES = {
  contacts: "cf-contacts",
  campaigns: "cf-campaigns",
  groups: "cf-groups"
};

function accessDenied(): Error {
  const err = new Error("Access Denied");
  err.name = "AccessDenied";
  return err;
}

function makeConfig(): ConfigService {
  const env: Record<string, string> = {
    AWS_REGION: "eu-north-1",
    JWT_SECRET: SECRET
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

type Items = Record<keyof typeof TABLES, Record<string, unknown>[]>;

const defaultItems: Items = {
  contacts: [
    { emailLower: "a@b.c", email: "A@b.c", groups: new Set(["g1"]) },
    { emailLower: "d@e.f", email: "d@e.f" }
  ],
  campaigns: [],
  groups: [{ id: "g1", name: "Clients" }]
};

function makeDdb(opts?: { items?: Items; failing?: string }): DdbService {
  const items = opts?.items ?? defaultItems;
  const logical = (table: string) =>
    (Object.keys(TABLES) as (keyof typeof TABLES)[]).find(
      (k) => TABLES[k] === table
    )!;
  return {
    tables: TABLES,
    scanCount: jest.fn(async (table: string) => {
      if (table === opts?.failing) throw accessDenied();
      return items[logical(table)].length;
    }),
    scanAll: jest.fn(async (table: string) => items[logical(table)])
  } as unknown as DdbService;
}

interface ColumnSeed {
  table_name: string;
  column_name: string;
  is_generated: "ALWAYS" | "NEVER";
}

const columnSeeds: ColumnSeed[] = [
  { table_name: "lex_users", column_name: "email", is_generated: "NEVER" },
  { table_name: "lex_users", column_name: "language", is_generated: "NEVER" },
  { table_name: "lex_users", column_name: "search", is_generated: "ALWAYS" },
  { table_name: "lex_empty", column_name: "id", is_generated: "NEVER" },
  { table_name: "lex_big", column_name: "n", is_generated: "NEVER" },
  { table_name: "pgmigrations", column_name: "name", is_generated: "NEVER" }
];

/**
 * Routes by statement: the schema queries, a count per table, and a DECLARE / FETCH / CLOSE cursor
 * per dumped table, served from the rows the test declared.
 */
function makePg(opts?: {
  configured?: boolean;
  rows?: Record<string, Record<string, unknown>[]>;
  failing?: boolean;
}): { pg: PgService; query: jest.Mock } {
  const rows = opts?.rows ?? {
    lex_users: [{ email: "a@b.c", language: "fr" }],
    pgmigrations: [{ name: "1753920000000_lex-initial-schema" }]
  };
  const tables = Object.keys(rows);
  const cursors = new Map<string, Record<string, unknown>[]>();

  const query = jest.fn(async (sql: string) => {
    if (opts?.failing) throw new Error("connection refused");
    if (sql.includes("information_schema.columns")) {
      return {
        rows: columnSeeds
          .filter((c) => tables.includes(c.table_name))
          .map((c) => ({
            ...c,
            data_type: "text",
            udt_name: "text",
            is_nullable: "YES",
            column_default: null
          }))
      };
    }
    if (sql.includes("information_schema.tables")) {
      return { rows: tables.map((t) => ({ table_name: t })) };
    }
    if (sql.includes("FROM pgmigrations ORDER BY")) {
      return { rows: rows.pgmigrations ?? [] };
    }
    const count = /count\(\*\)::text AS n FROM "([^"]+)"/.exec(sql);
    if (count) return { rows: [{ n: String(rows[count[1]].length) }] };
    const declare = /^DECLARE "snapshot_([^"]+)"/.exec(sql);
    if (declare) {
      cursors.set(declare[1], [...rows[declare[1]]]);
      return { rows: [] };
    }
    const fetch = /^FETCH FORWARD (\d+) FROM "snapshot_([^"]+)"/.exec(sql);
    if (fetch) {
      return { rows: cursors.get(fetch[2])!.splice(0, Number(fetch[1])) };
    }
    return { rows: [] }; // SET TRANSACTION, CLOSE
  });

  const client = { query };
  const pg = {
    isConfigured: () => opts?.configured ?? true,
    query,
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) =>
      fn(client)
  } as unknown as PgService;
  return { pg, query };
}

type Objects = Record<string, string | Error>;

function makeStore(
  bucket: string,
  objects: Objects,
  opts?: { configured?: boolean; listFails?: boolean }
) {
  return {
    bucketName: bucket,
    isConfigured: () => opts?.configured ?? true,
    list: async function* () {
      if (opts?.listFails) throw accessDenied();
      for (const [key, value] of Object.entries(objects)) {
        yield { key, size: typeof value === "string" ? value.length : 0 };
      }
    },
    get: jest.fn(async (key: string) => {
      const value = objects[key];
      if (value instanceof Error) throw value;
      return {
        body: Buffer.from(value),
        contentType: "application/octet-stream",
        versionId: "v-source"
      };
    })
  };
}

function makeService(parts?: {
  ddb?: DdbService;
  pg?: PgService;
  s3?: ReturnType<typeof makeStore>;
  lexS3?: ReturnType<typeof makeStore>;
}): SnapshotService {
  return new SnapshotService(
    makeConfig(),
    parts?.ddb ?? makeDdb(),
    parts?.pg ?? makePg().pg,
    (parts?.s3 ??
      makeStore("cf-attachments", {
        "logo.png": "png-bytes"
      })) as unknown as S3Service,
    (parts?.lexS3 ??
      makeStore("cf-lex-docs", {
        "lex/ws-1/doc-1/original.pdf": "%PDF-1.7"
      })) as unknown as LexS3Service
  );
}

/** The pinned @types/node and the compiler's lib disagree on Buffer's backing type; a plain view settles it. */
const bytes = (b: Buffer) =>
  new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** Central directory first, then each local header's data, inflated. Enough for a small archive. */
function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error("bad central header");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 8 ? inflateRawSync(bytes(data)) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function collect(service: SnapshotService): Promise<Map<string, Buffer>> {
  const planned = await service.plan();
  const sink = new PassThrough();
  const chunks: Uint8Array[] = [];
  sink.on("data", (c: Buffer) => chunks.push(new Uint8Array(c)));
  const finished = new Promise<void>((resolve) => sink.on("end", resolve));
  await service.write(planned, sink);
  await finished;
  return readZip(Buffer.concat(chunks));
}

const lines = (entry: Buffer | undefined) =>
  entry!.toString("utf8").split("\n").filter(Boolean);

describe("SnapshotService.inventory", () => {
  it("counts every table, every bucket and the Lex database", async () => {
    const inv = await makeService().inventory();
    expect(inv.region).toBe("eu-north-1");
    expect(inv.dynamodb).toEqual([
      { logicalName: "contacts", tableName: "cf-contacts", items: 2 },
      { logicalName: "campaigns", tableName: "cf-campaigns", items: 0 },
      { logicalName: "groups", tableName: "cf-groups", items: 1 }
    ]);
    expect(inv.postgres).toEqual({
      configured: true,
      tables: [
        { name: "lex_users", rows: 1 },
        { name: "pgmigrations", rows: 1 }
      ],
      appliedMigrations: ["1753920000000_lex-initial-schema"]
    });
    expect(inv.s3).toEqual([
      {
        logicalName: "campaign-attachments",
        bucket: "cf-attachments",
        objects: 1,
        bytes: 9
      },
      {
        logicalName: "lex-documents",
        bucket: "cf-lex-docs",
        objects: 1,
        bytes: 8
      }
    ]);
    expect(inv.errors).toEqual([]);
  });

  it("reports one unreadable source as one line and still counts the others", async () => {
    const inv = await makeService({
      ddb: makeDdb({ failing: "cf-groups" }),
      lexS3: makeStore("cf-lex-docs", {}, { listFails: true })
    }).inventory();
    expect(inv.dynamodb.map((t) => t.logicalName)).toEqual([
      "contacts",
      "campaigns"
    ]);
    expect(inv.errors).toEqual([
      { source: "dynamodb:cf-groups", message: "AccessDenied: Access Denied" },
      { source: "s3:cf-lex-docs", message: "AccessDenied: Access Denied" }
    ]);
  });

  it("treats an unconfigured Lex as nothing to export, not as an error", async () => {
    const inv = await makeService({
      pg: makePg({ configured: false }).pg,
      lexS3: makeStore("unused", {}, { configured: false })
    }).inventory();
    expect(inv.postgres).toEqual({
      configured: false,
      tables: [],
      appliedMigrations: []
    });
    expect(inv.s3.map((b) => b.logicalName)).toEqual(["campaign-attachments"]);
    expect(inv.errors).toEqual([]);
  });

  it("reports an unreachable Lex database as an error", async () => {
    const inv = await makeService({
      pg: makePg({ failing: true }).pg
    }).inventory();
    expect(inv.errors).toEqual([
      { source: "postgres", message: "connection refused" }
    ]);
  });
});

describe("SnapshotService.plan", () => {
  it("refuses while a source cannot be read", () => {
    const service = makeService({ ddb: makeDdb({ failing: "cf-contacts" }) });
    return expect(service.plan()).rejects.toBeInstanceOf(ConflictException);
  });

  it("names the archive after the moment it was planned", async () => {
    const { filename } = await makeService().plan();
    expect(filename).toMatch(/^campaign-forge-snapshot-\d{8}-\d{6}Z\.zip$/);
  });
});

describe("SnapshotService.issueDownloadTicket", () => {
  it("mints a short-lived token carrying the email and the download purpose", () => {
    const { token, expiresIn } = makeService().issueDownloadTicket("a@b.c");
    expect(expiresIn).toBe(DOWNLOAD_TICKET_TTL_SECONDS);
    const payload = verify(token, SECRET) as {
      email: string;
      purpose: string;
      exp: number;
      iat: number;
    };
    expect(payload.email).toBe("a@b.c");
    expect(payload.purpose).toBe(SNAPSHOT_DOWNLOAD_PURPOSE);
    expect(payload.exp - payload.iat).toBe(DOWNLOAD_TICKET_TTL_SECONDS);
  });
});

describe("SnapshotService.write", () => {
  it("writes every store into one archive with a manifest that counts it", async () => {
    const entries = await collect(makeService());

    expect([...entries.keys()]).toEqual([
      "README.md",
      "dynamodb/contacts.ndjson",
      "dynamodb/campaigns.ndjson",
      "dynamodb/groups.ndjson",
      "postgres/schema.json",
      "postgres/lex_users.ndjson",
      "postgres/pgmigrations.ndjson",
      "s3/campaign-attachments/logo.png",
      "s3/lex-documents/lex/ws-1/doc-1/original.pdf",
      "manifest.json"
    ]);

    // A string set comes back as an array, so a restore can write it without the document client.
    expect(lines(entries.get("dynamodb/contacts.ndjson"))).toEqual([
      '{"emailLower":"a@b.c","email":"A@b.c","groups":["g1"]}',
      '{"emailLower":"d@e.f","email":"d@e.f"}'
    ]);
    expect(lines(entries.get("dynamodb/campaigns.ndjson"))).toEqual([]);

    const schema = JSON.parse(entries.get("postgres/schema.json")!.toString());
    expect(schema.appliedMigrations).toEqual([
      "1753920000000_lex-initial-schema"
    ]);
    expect(
      schema.tables.find((t: { name: string }) => t.name === "lex_users")
        .columns
    ).toEqual([
      expect.objectContaining({ name: "email", generated: false }),
      expect.objectContaining({ name: "language", generated: false }),
      expect.objectContaining({ name: "search", generated: true })
    ]);
    expect(lines(entries.get("postgres/lex_users.ndjson"))).toEqual([
      '{"email":"a@b.c","language":"fr"}'
    ]);

    expect(entries.get("s3/campaign-attachments/logo.png")!.toString()).toBe(
      "png-bytes"
    );

    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    expect(manifest.format).toBe(1);
    expect(manifest.completedAt).toEqual(expect.any(String));
    expect(manifest.dynamodb).toEqual([
      expect.objectContaining({
        logicalName: "contacts",
        items: 2,
        entry: "dynamodb/contacts.ndjson"
      }),
      expect.objectContaining({ logicalName: "campaigns", items: 0 }),
      expect.objectContaining({ logicalName: "groups", items: 1 })
    ]);
    expect(manifest.postgres.tables).toEqual([
      { name: "lex_users", rows: 1, entry: "postgres/lex_users.ndjson" },
      { name: "pgmigrations", rows: 1, entry: "postgres/pgmigrations.ndjson" }
    ]);
    expect(manifest.s3[1]).toEqual({
      logicalName: "lex-documents",
      bucket: "cf-lex-docs",
      bytes: 8,
      objects: [
        {
          key: "lex/ws-1/doc-1/original.pdf",
          entry: "s3/lex-documents/lex/ws-1/doc-1/original.pdf",
          size: 8,
          contentType: "application/octet-stream",
          versionId: "v-source"
        }
      ]
    });
    expect(manifest.failures).toEqual([]);
  });

  it("reads the Lex tables in one repeatable-read transaction, without generated columns, and closes each cursor", async () => {
    const { pg, query } = makePg();
    await collect(makeService({ pg }));

    const sql = query.mock.calls.map((c: unknown[]) => String(c[0]));
    const begin = sql.findIndex((s) =>
      s.startsWith("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    );
    const schema = sql.findIndex(
      (s) =>
        s.includes("information_schema.columns") &&
        begin < sql.indexOf(s, begin)
    );
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(schema).toBeGreaterThan(begin);
    expect(sql).toContain(
      'DECLARE "snapshot_lex_users" NO SCROLL CURSOR FOR SELECT "email", "language" FROM "lex_users"'
    );
    expect(sql).toContain('CLOSE "snapshot_lex_users"');
    expect(sql).toContain('CLOSE "snapshot_pgmigrations"');
  });

  it("streams a table in batches and dumps an empty table as an empty file", async () => {
    const big = Array.from({ length: 1200 }, (_, n) => ({ n }));
    const { pg } = makePg({ rows: { lex_big: big, lex_empty: [] } });
    const entries = await collect(makeService({ pg }));

    expect(lines(entries.get("postgres/lex_big.ndjson"))).toHaveLength(1200);
    expect(lines(entries.get("postgres/lex_big.ndjson"))[1199]).toBe(
      '{"n":1199}'
    );
    expect(entries.get("postgres/lex_empty.ndjson")!.length).toBe(0);
  });

  it("skips an object S3 will not return and records it in the manifest", async () => {
    const lexS3 = makeStore("cf-lex-docs", {
      "lex/ok.pdf": "ok",
      "lex/gone.pdf": Object.assign(
        new Error("The specified key does not exist."),
        {
          name: "NoSuchKey"
        }
      )
    });
    const entries = await collect(makeService({ lexS3 }));

    expect(entries.has("s3/lex-documents/lex/ok.pdf")).toBe(true);
    expect(entries.has("s3/lex-documents/lex/gone.pdf")).toBe(false);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    expect(manifest.s3[1].objects.map((o: { key: string }) => o.key)).toEqual([
      "lex/ok.pdf"
    ]);
    expect(manifest.failures).toEqual([
      {
        source: "s3:cf-lex-docs",
        key: "lex/gone.pdf",
        error: "NoSuchKey: The specified key does not exist."
      }
    ]);
  });

  it("renames an object whose key would escape the archive and keeps the real key in the manifest", async () => {
    const s3 = makeStore("cf-attachments", { "../evil.bin": "x" });
    const entries = await collect(makeService({ s3 }));

    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    const [record] = manifest.s3[0].objects;
    expect(record.key).toBe("../evil.bin");
    expect(record.entry).toMatch(
      /^s3\/campaign-attachments\/evil\.bin__[0-9a-f]{12}$/
    );
    expect(entries.has(record.entry)).toBe(true);
  });

  it("leaves the Lex sections out of the archive when Lex is not configured", async () => {
    const entries = await collect(
      makeService({
        pg: makePg({ configured: false }).pg,
        lexS3: makeStore("unused", {}, { configured: false })
      })
    );
    expect(
      [...entries.keys()].filter((n) => n.startsWith("postgres/"))
    ).toEqual([]);
    expect([...entries.keys()].filter((n) => n.startsWith("s3/lex-"))).toEqual(
      []
    );
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    expect(manifest.postgres).toEqual({
      configured: false,
      appliedMigrations: [],
      tables: []
    });
  });
});
