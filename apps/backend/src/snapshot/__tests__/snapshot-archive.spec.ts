import {
  dumpedColumns,
  groupColumns,
  jsonLine,
  objectEntryName,
  quoteIdent,
  selectTableSql,
  snapshotFilename,
  type ColumnRow
} from "../snapshot-archive";

/**
 * The pure half of the snapshot: how a record becomes a line, where an object lands in the
 * archive, and which columns a table dump selects. The archive is the thing a future restore reads,
 * so what is pinned here is the format, not the implementation.
 */

describe("jsonLine", () => {
  it("writes one newline-terminated JSON object", () => {
    expect(jsonLine({ a: 1 })).toBe('{"a":1}\n');
  });

  it("turns a Set into an array, as the document client hands back a string set", () => {
    expect(jsonLine({ groups: new Set(["g1", "g2"]) })).toBe(
      '{"groups":["g1","g2"]}\n'
    );
  });

  it("writes a Date as ISO 8601", () => {
    expect(jsonLine({ at: new Date("2026-10-17T10:30:00.000Z") })).toBe(
      '{"at":"2026-10-17T10:30:00.000Z"}\n'
    );
  });
});

describe("snapshotFilename", () => {
  it("stamps the archive to the second in UTC", () => {
    expect(snapshotFilename(new Date("2026-10-17T10:30:05.123Z"))).toBe(
      "campaign-forge-snapshot-20261017-103005Z.zip"
    );
  });
});

describe("objectEntryName", () => {
  it("keeps a normal key as the path under the bucket folder", () => {
    expect(
      objectEntryName("lex-documents", "lex/ws-1/doc-1/original.pdf")
    ).toBe("s3/lex-documents/lex/ws-1/doc-1/original.pdf");
  });

  it("neutralises a path escape and keeps the entry unique with a hash", () => {
    const a = objectEntryName("campaign-attachments", "../etc/passwd");
    const b = objectEntryName("campaign-attachments", "etc/../passwd");
    expect(a.startsWith("s3/campaign-attachments/etc/passwd__")).toBe(true);
    expect(b.startsWith("s3/campaign-attachments/etc/passwd__")).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain("..");
  });

  it("gives a key made only of separators a name", () => {
    expect(objectEntryName("campaign-attachments", "/")).toMatch(
      /^s3\/campaign-attachments\/object__[0-9a-f]{12}$/
    );
  });
});

describe("quoteIdent", () => {
  it("double-quotes and escapes an embedded quote", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

const rows: ColumnRow[] = [
  {
    table_name: "lex_users",
    column_name: "email",
    data_type: "text",
    udt_name: "text",
    is_nullable: "NO",
    column_default: null,
    is_generated: "NEVER"
  },
  {
    table_name: "lex_users",
    column_name: "search",
    data_type: "tsvector",
    udt_name: "tsvector",
    is_nullable: "YES",
    column_default: null,
    is_generated: "ALWAYS"
  },
  {
    table_name: "lex_document_chunks",
    column_name: "embedding",
    data_type: "USER-DEFINED",
    udt_name: "halfvec",
    is_nullable: "YES",
    column_default: null,
    is_generated: "NEVER"
  }
];

describe("groupColumns / selectTableSql", () => {
  it("groups information_schema rows by table in order", () => {
    const tables = groupColumns(rows);
    expect(tables.map((t) => t.name)).toEqual([
      "lex_users",
      "lex_document_chunks"
    ]);
    expect(tables[1].columns[0]).toEqual({
      name: "embedding",
      dataType: "USER-DEFINED",
      udtName: "halfvec",
      nullable: true,
      default: null,
      generated: false
    });
  });

  it("selects named columns and leaves a generated column out", () => {
    const [users] = groupColumns(rows);
    expect(dumpedColumns(users).map((c) => c.name)).toEqual(["email"]);
    expect(selectTableSql(users)).toBe('SELECT "email" FROM "lex_users"');
  });
});
