import { createHash } from "node:crypto";
import type { SnapshotBucket, SnapshotDynamoTable } from "@packages/types";

/** Claim on a download token. A session token has none, and AdminGuard keeps the two apart. */
export const SNAPSHOT_DOWNLOAD_PURPOSE = "snapshot-download";

/** Bumped when the archive layout changes, so a restore script can refuse what it does not know. */
export const SNAPSHOT_FORMAT = 1;

/** One record per line. A Set is what DynamoDB's document client returns for a string-set attribute. */
export function jsonLine(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) =>
      v instanceof Set ? [...v] : v
    ) + "\n"
  );
}

/** campaign-forge-snapshot-20261017-103000Z.zip */
export function snapshotFilename(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `campaign-forge-snapshot-${stamp}.zip`;
}

export function dynamoEntryName(table: SnapshotDynamoTable): string {
  return `dynamodb/${table}.ndjson`;
}

export function postgresEntryName(table: string): string {
  return `postgres/${table}.ndjson`;
}

/**
 * Where an object lands in the archive. The key is kept as it is, so a file is findable without
 * the manifest, unless it holds something an unzip tool would read as a path escape: "..", a
 * leading slash, an empty segment. Those are dropped and a hash of the original key is appended,
 * so two keys can never collapse onto one entry. manifest.json carries the exact key either way.
 */
export function objectEntryName(bucket: SnapshotBucket, key: string): string {
  const safe = key
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .join("/");
  let name = safe;
  if (name !== key) {
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
    name = `${name || "object"}__${hash}`;
  }
  return `s3/${bucket}/${name}`;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** One row of information_schema.columns, as the schema query returns it. */
export interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_generated: "ALWAYS" | "NEVER";
}

export interface PostgresColumn {
  name: string;
  /** information_schema's data_type: "USER-DEFINED" for pgvector's halfvec, hence udtName beside it. */
  dataType: string;
  udtName: string;
  nullable: boolean;
  default: string | null;
  /** Computed by Postgres on write, so it is left out of the dump and must be left out of the restore. */
  generated: boolean;
}

export interface PostgresTableSchema {
  name: string;
  columns: PostgresColumn[];
}

export function groupColumns(rows: ColumnRow[]): PostgresTableSchema[] {
  const tables = new Map<string, PostgresTableSchema>();
  for (const r of rows) {
    let table = tables.get(r.table_name);
    if (!table) {
      table = { name: r.table_name, columns: [] };
      tables.set(r.table_name, table);
    }
    table.columns.push({
      name: r.column_name,
      dataType: r.data_type,
      udtName: r.udt_name,
      nullable: r.is_nullable === "YES",
      default: r.column_default,
      generated: r.is_generated === "ALWAYS"
    });
  }
  return [...tables.values()];
}

export function dumpedColumns(table: PostgresTableSchema): PostgresColumn[] {
  return table.columns.filter((c) => !c.generated);
}

/** The SELECT behind a table's dump. Named columns, never *, so a generated column is not written out. */
export function selectTableSql(table: PostgresTableSchema): string {
  const cols = dumpedColumns(table)
    .map((c) => quoteIdent(c.name))
    .join(", ");
  return `SELECT ${cols} FROM ${quoteIdent(table.name)}`;
}

export interface SnapshotObjectRecord {
  key: string;
  entry: string;
  size: number;
  contentType: string;
  /** The id in the SOURCE bucket. A restored object gets a new one. */
  versionId?: string;
}

export interface SnapshotFailure {
  source: string;
  key?: string;
  error: string;
}

/** Written last, so it can carry the counts and the failures of everything before it. */
export interface SnapshotManifest {
  format: number;
  generatedAt: string;
  completedAt: string | null;
  region: string;
  dynamodb: {
    logicalName: SnapshotDynamoTable;
    tableName: string;
    items: number;
    entry: string;
  }[];
  postgres: {
    configured: boolean;
    appliedMigrations: string[];
    tables: { name: string; rows: number; entry: string }[];
  };
  s3: {
    logicalName: SnapshotBucket;
    bucket: string;
    bytes: number;
    objects: SnapshotObjectRecord[];
  }[];
  failures: SnapshotFailure[];
}

export function renderReadme(): string {
  return `# Campaign Forge data snapshot

Everything the application stores, read from one deployment at the time given by \`generatedAt\`
in manifest.json. Built for moving to another AWS account: nothing in here depends on the account
it came from, except the S3 version ids noted below.

## Layout

- \`manifest.json\`: what was exported, counted at the end. Every file under \`s3/\` is listed with
  its exact object key. \`failures\` names anything that could not be read; check it is empty
  before trusting the archive.
- \`dynamodb/<table>.ndjson\`: one item per line, as stored, index attributes (\`gsi1pk\`,
  \`gsi1sk\`) included. Tables: contacts, campaigns, groups.
- \`postgres/schema.json\`: every table of the Lex database with its columns, and the migrations
  node-pg-migrate had applied.
- \`postgres/<table>.ndjson\`: one row per line, column names as keys. All tables were read in one
  REPEATABLE READ transaction, so they agree with each other. Vectors (halfvec) are in their text
  form \`[0.1,...]\`, timestamps are ISO 8601, bigint and numeric values are strings.
- \`s3/campaign-attachments/<key>\`: the campaign attachments bucket (S3_BUCKET).
- \`s3/lex-documents/<key>\`: the Lex documents bucket (LEX_DOCUMENTS_BUCKET), current version of
  each object. A key that was unsafe as a path has been renamed and suffixed with a hash in the
  archive; the manifest holds the real key.

## Restoring into a new account

1. Create the three DynamoDB tables (docs/DEPLOYMENT.md has the commands) and write each
   \`dynamodb/*.ndjson\` back with the document client or \`aws dynamodb batch-write-item\`. Items
   are already in their final shape.
2. Create the Lex Postgres (infrastructure/lib/lex-data-stack.ts), run \`pnpm migrate\` to build
   the schema, then load each \`postgres/*.ndjson\`, skipping the \`pgmigrations\` table and any
   column marked \`generated\` in schema.json. Cast vector columns with \`::halfvec\`. Load tables
   that are referenced by foreign keys first (workspaces, documents, conversations, then the rest).
3. Upload every file under \`s3/<bucket>/\` into the new bucket under the key from manifest.json,
   not the entry path.
4. \`s3_version_id\` in lex_documents, lex_authorities and lex_message_audio refers to the source
   bucket. Replace each with the id the new bucket returned, or set them to NULL so the app reads
   the current version.
5. Point SSM at the new tables, buckets and database (scripts/setup-ssm-params.sh) and deploy.
`;
}
