/** The Campaigns tables, named as the app knows them rather than by their deployed table name. */
export type SnapshotDynamoTable = "contacts" | "campaigns" | "groups";

/** The buckets a deployment can hold files in. Lex's is absent while LEX_DOCUMENTS_BUCKET is unset. */
export type SnapshotBucket = "campaign-attachments" | "lex-documents";

export interface SnapshotDynamoTableInventory {
  logicalName: SnapshotDynamoTable;
  tableName: string;
  items: number;
}

export interface SnapshotPostgresTableInventory {
  name: string;
  rows: number;
}

export interface SnapshotPostgresInventory {
  /** False on a Campaigns-only deployment (no DATABASE_URL): nothing to export, not an error. */
  configured: boolean;
  tables: SnapshotPostgresTableInventory[];
  /** node-pg-migrate's record of what has run, so the restore side knows which schema to build. */
  appliedMigrations: string[];
}

export interface SnapshotBucketInventory {
  logicalName: SnapshotBucket;
  bucket: string;
  objects: number;
  bytes: number;
}

/** One source that could not be read. Usually a missing IAM permission; the message is AWS's own. */
export interface SnapshotSourceError {
  source: string;
  message: string;
}

/**
 * What a snapshot would contain, counted live. Shown before the download so the admin can see the
 * size and any source that is unreachable. A download is refused while `errors` is non-empty: a
 * migration archive with a table silently missing is worse than no archive.
 */
export interface DataSnapshotInventory {
  generatedAt: string;
  region: string;
  dynamodb: SnapshotDynamoTableInventory[];
  postgres: SnapshotPostgresInventory;
  s3: SnapshotBucketInventory[];
  errors: SnapshotSourceError[];
}

/**
 * A short-lived token that authorises one snapshot download by URL. The archive can run to
 * gigabytes, so the browser must stream it to disk itself, and a plain navigation cannot carry the
 * bearer header.
 */
export interface DataSnapshotDownloadTicket {
  token: string;
  /** Seconds until the token expires. */
  expiresIn: number;
}
