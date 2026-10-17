import { Readable, type Writable } from "node:stream";
import { ConflictException, Injectable, Logger } from "@nestjs/common";
import type {
  DataSnapshotDownloadTicket,
  DataSnapshotInventory,
  SnapshotBucket,
  SnapshotBucketInventory,
  SnapshotDynamoTable,
  SnapshotDynamoTableInventory,
  SnapshotPostgresInventory,
  SnapshotSourceError
} from "@packages/types";
import archiver from "archiver";
import { sign } from "jsonwebtoken";
import type { PoolClient } from "pg";
import { ConfigService } from "../config/config.service";
import { DdbService } from "../shared/ddb.service";
import { LexS3Service } from "../shared/lex-s3.service";
import { PgService } from "../shared/pg.service";
import { S3Service } from "../shared/s3.service";
import {
  dynamoEntryName,
  groupColumns,
  jsonLine,
  objectEntryName,
  postgresEntryName,
  quoteIdent,
  renderReadme,
  selectTableSql,
  SNAPSHOT_DOWNLOAD_PURPOSE,
  SNAPSHOT_FORMAT,
  snapshotFilename,
  type ColumnRow,
  type PostgresTableSchema,
  type SnapshotManifest
} from "./snapshot-archive";

/**
 * Long enough for the ticket round-trip and the browser's navigation, short enough that a URL
 * copied out of an access log is dead by the time anyone reads it.
 */
export const DOWNLOAD_TICKET_TTL_SECONDS = 120;

/** Rows per FETCH. A chunk row carries a 3072-dim vector, about 12 KB as text, so this is a few MB. */
const FETCH_ROWS = 500;

const DYNAMO_TABLES: SnapshotDynamoTable[] = [
  "contacts",
  "campaigns",
  "groups"
];

const TABLES_SQL = `SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;

const COLUMNS_SQL = `SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
         c.is_nullable, c.column_default, c.is_generated
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position`;

const MIGRATIONS_SQL = `SELECT name FROM pgmigrations ORDER BY run_on, id`;

export interface PlannedSnapshot {
  inventory: DataSnapshotInventory;
  /** Decided before streaming so the Content-Disposition header is right. */
  filename: string;
}

/** What the export needs from a bucket. Both S3 services provide it. */
interface ObjectStore {
  list(): AsyncGenerator<{ key: string; size: number }>;
  get(
    key: string
  ): Promise<{ body: Buffer; contentType: string; versionId?: string }>;
}

interface BucketSource {
  logicalName: SnapshotBucket;
  bucket: string;
  store: ObjectStore;
}

/**
 * One zip with every table and every stored file, for moving the whole deployment to another AWS
 * account. Same shape as MessageBundleService: plan() does everything that can fail with a status
 * code, write() streams into the response and can only truncate from then on.
 *
 * Point in time, not a true snapshot: DynamoDB scans and S3 listings are read as they come, and
 * only the Postgres tables share one transaction. The UI says so, and asks the admin not to write
 * during the download.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private config: ConfigService,
    private ddb: DdbService,
    private pg: PgService,
    private s3: S3Service,
    private lexS3: LexS3Service
  ) {}

  /**
   * Counts every source, catching per source so one missing permission reports as one line rather
   * than as a 500 that hides whether the other sources are fine.
   */
  async inventory(): Promise<DataSnapshotInventory> {
    const errors: SnapshotSourceError[] = [];

    const dynamodb: SnapshotDynamoTableInventory[] = [];
    for (const logicalName of DYNAMO_TABLES) {
      const tableName = this.ddb.tables[logicalName];
      try {
        const items = await this.ddb.scanCount(tableName);
        dynamodb.push({ logicalName, tableName, items });
      } catch (err) {
        errors.push({
          source: `dynamodb:${tableName}`,
          message: messageOf(err)
        });
      }
    }

    const postgres = await this.postgresInventory(errors);

    const s3: SnapshotBucketInventory[] = [];
    for (const source of this.buckets()) {
      try {
        let objects = 0;
        let bytes = 0;
        for await (const obj of source.store.list()) {
          objects += 1;
          bytes += obj.size;
        }
        s3.push({
          logicalName: source.logicalName,
          bucket: source.bucket,
          objects,
          bytes
        });
      } catch (err) {
        errors.push({ source: `s3:${source.bucket}`, message: messageOf(err) });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      region: this.config.get("AWS_REGION"),
      dynamodb,
      postgres,
      s3,
      errors
    };
  }

  /**
   * Signed with the session secret but carrying a purpose claim, so AdminGuard refuses it as a
   * session and the download route refuses a session token in its place.
   */
  issueDownloadTicket(email: string): DataSnapshotDownloadTicket {
    const token = sign(
      { email, purpose: SNAPSHOT_DOWNLOAD_PURPOSE },
      this.config.get("JWT_SECRET"),
      { expiresIn: DOWNLOAD_TICKET_TTL_SECONDS }
    );
    return { token, expiresIn: DOWNLOAD_TICKET_TTL_SECONDS };
  }

  /** Refuses while any source is unreadable: a migration archive missing a table must not look complete. */
  async plan(): Promise<PlannedSnapshot> {
    const inventory = await this.inventory();
    if (inventory.errors.length > 0) {
      throw new ConflictException(
        "Snapshot refused, a source cannot be read: " +
          inventory.errors.map((e) => `${e.source} (${e.message})`).join("; ")
      );
    }
    return {
      inventory,
      filename: snapshotFilename(new Date(inventory.generatedAt))
    };
  }

  /**
   * Streams the zip into `out`, the HTTP response. Entries go in one at a time and each waits for
   * archiver to drain it, so peak memory is one DynamoDB table, one batch of rows or one S3 object,
   * never the archive.
   *
   * An S3 object that cannot be fetched is skipped and written into manifest.json, like the pièces
   * bundle: a 500 halfway through a multi-gigabyte transfer costs the admin everything that did
   * resolve. A database failure is not skippable and ends the download, truncated.
   */
  async write(planned: PlannedSnapshot, out: Writable): Promise<void> {
    const { inventory } = planned;
    const archive = archiver("zip", { zlib: { level: 1 } });

    archive.on("error", (err) =>
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "snapshotArchiveError",
          error: String(err)
        })
      )
    );
    archive.on("warning", (err) =>
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "snapshotArchiveWarning",
          error: String(err)
        })
      )
    );

    // A closed response would otherwise leave archiver blocked on backpressure for good, with the
    // next S3 object held in memory. Aborting makes the next append reject instead.
    let done = false;
    const onClose = () => {
      if (!done) archive.abort();
    };
    out.once("close", onClose);

    archive.pipe(out);

    const manifest: SnapshotManifest = {
      format: SNAPSHOT_FORMAT,
      generatedAt: inventory.generatedAt,
      completedAt: null,
      region: inventory.region,
      dynamodb: [],
      postgres: {
        configured: inventory.postgres.configured,
        appliedMigrations: inventory.postgres.appliedMigrations,
        tables: []
      },
      s3: [],
      failures: []
    };

    await this.appendEntry(
      archive,
      Buffer.from(renderReadme(), "utf8"),
      "README.md"
    );
    await this.writeDynamo(archive, manifest);
    if (inventory.postgres.configured)
      await this.writePostgres(archive, manifest);
    for (const source of this.buckets()) {
      await this.writeBucket(archive, source, manifest);
    }

    // Last, so it can report everything before it.
    manifest.completedAt = new Date().toISOString();
    await this.appendEntry(
      archive,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      "manifest.json"
    );

    await archive.finalize();
    done = true;
    out.off("close", onClose);
  }

  private buckets(): BucketSource[] {
    const sources: BucketSource[] = [
      {
        logicalName: "campaign-attachments",
        bucket: this.s3.bucketName,
        store: this.s3
      }
    ];
    if (this.lexS3.isConfigured()) {
      sources.push({
        logicalName: "lex-documents",
        bucket: this.lexS3.bucketName,
        store: this.lexS3
      });
    }
    return sources;
  }

  private async postgresInventory(
    errors: SnapshotSourceError[]
  ): Promise<SnapshotPostgresInventory> {
    if (!this.pg.isConfigured()) {
      return { configured: false, tables: [], appliedMigrations: [] };
    }
    try {
      const names = await this.pg.query<{ table_name: string }>(TABLES_SQL);
      const tables = [];
      for (const { table_name } of names.rows) {
        const res = await this.pg.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${quoteIdent(table_name)}`
        );
        tables.push({ name: table_name, rows: Number(res.rows[0].n) });
      }
      return {
        configured: true,
        tables,
        appliedMigrations: await this.appliedMigrations()
      };
    } catch (err) {
      errors.push({ source: "postgres", message: messageOf(err) });
      return { configured: true, tables: [], appliedMigrations: [] };
    }
  }

  /** Empty, not an error, when the migrations table does not exist: a database nothing has run on yet. */
  private async appliedMigrations(): Promise<string[]> {
    try {
      const res = await this.pg.query<{ name: string }>(MIGRATIONS_SQL);
      return res.rows.map((r) => r.name);
    } catch {
      return [];
    }
  }

  /** A whole table at a time: these are a newsletter's contacts and campaigns, a few MB at most. */
  private async writeDynamo(
    archive: archiver.Archiver,
    manifest: SnapshotManifest
  ): Promise<void> {
    for (const logicalName of DYNAMO_TABLES) {
      const tableName = this.ddb.tables[logicalName];
      const items = await this.ddb.scanAll(tableName);
      const entry = dynamoEntryName(logicalName);
      await this.appendEntry(
        archive,
        Buffer.from(items.map(jsonLine).join(""), "utf8"),
        entry
      );
      manifest.dynamodb.push({
        logicalName,
        tableName,
        items: items.length,
        entry
      });
    }
  }

  /**
   * One REPEATABLE READ transaction for the schema and every table, so a document ingested while
   * the dump runs cannot show up in lex_documents but not in lex_document_chunks.
   */
  private async writePostgres(
    archive: archiver.Archiver,
    manifest: SnapshotManifest
  ): Promise<void> {
    await this.pg.withTransaction(async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      const columns = await client.query<ColumnRow>(COLUMNS_SQL);
      const tables = groupColumns(columns.rows);

      await this.appendEntry(
        archive,
        Buffer.from(
          JSON.stringify(
            {
              appliedMigrations: manifest.postgres.appliedMigrations,
              tables
            },
            null,
            2
          ),
          "utf8"
        ),
        "postgres/schema.json"
      );

      for (const table of tables) {
        const entry = postgresEntryName(table.name);
        const counter = { rows: 0 };
        // A stream, not a buffer: lex_document_chunks holds every vector of every case file, and
        // archiver pulls from the cursor only as fast as the response drains.
        await this.appendEntry(
          archive,
          Readable.from(this.tableLines(client, table, counter), {
            objectMode: false
          }),
          entry
        );
        manifest.postgres.tables.push({
          name: table.name,
          rows: counter.rows,
          entry
        });
      }
    });
  }

  private async *tableLines(
    client: PoolClient,
    table: PostgresTableSchema,
    counter: { rows: number }
  ): AsyncGenerator<Buffer> {
    const cursor = quoteIdent(`snapshot_${table.name}`);
    await client.query(
      `DECLARE ${cursor} NO SCROLL CURSOR FOR ${selectTableSql(table)}`
    );
    try {
      for (;;) {
        const res = await client.query(
          `FETCH FORWARD ${FETCH_ROWS} FROM ${cursor}`
        );
        if (res.rows.length === 0) return;
        counter.rows += res.rows.length;
        yield Buffer.from(res.rows.map(jsonLine).join(""), "utf8");
      }
    } finally {
      // Swallowed on purpose: after a failed FETCH the transaction is already aborted and CLOSE
      // would only replace the real error with "current transaction is aborted".
      await client.query(`CLOSE ${cursor}`).catch(() => undefined);
    }
  }

  private async writeBucket(
    archive: archiver.Archiver,
    source: BucketSource,
    manifest: SnapshotManifest
  ): Promise<void> {
    const objects: SnapshotManifest["s3"][number]["objects"] = [];
    let bytes = 0;

    for await (const obj of source.store.list()) {
      const entry = objectEntryName(source.logicalName, obj.key);

      // The fetch is what can fail for one object; the append failing means the archive is gone.
      let fetched: Awaited<ReturnType<ObjectStore["get"]>>;
      try {
        fetched = await source.store.get(obj.key);
      } catch (err) {
        manifest.failures.push({
          source: `s3:${source.bucket}`,
          key: obj.key,
          error: messageOf(err)
        });
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "snapshotObjectMissing",
            bucket: source.bucket,
            key: obj.key,
            error: String(err)
          })
        );
        continue;
      }

      await this.appendEntry(archive, fetched.body, entry);
      objects.push({
        key: obj.key,
        entry,
        size: fetched.body.length,
        contentType: fetched.contentType,
        ...(fetched.versionId && { versionId: fetched.versionId })
      });
      bytes += fetched.body.length;
    }

    manifest.s3.push({
      logicalName: source.logicalName,
      bucket: source.bucket,
      bytes,
      objects
    });
  }

  /**
   * Append one entry and wait for archiver to have processed it. append() itself is
   * fire-and-forget, and queuing every entry would hold the whole archive in memory.
   */
  private appendEntry(
    archive: archiver.Archiver,
    body: Buffer | Readable,
    name: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onEntry = (entry: { name?: string }) => {
        if (entry?.name !== name) return;
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        archive.off("entry", onEntry);
        archive.off("error", onError);
      };
      archive.on("entry", onEntry);
      archive.on("error", onError);
      archive.append(body, { name });
    });
  }
}

/** AWS errors carry the useful part in `name` (AccessDenied, ResourceNotFoundException). */
function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.name && err.name !== "Error"
      ? `${err.name}: ${err.message}`
      : err.message;
  }
  return String(err);
}
