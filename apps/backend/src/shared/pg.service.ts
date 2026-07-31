import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { ConfigService } from "../config/config.service";

/**
 * Thin wrapper around a single `pg` connection pool for the Lex PostgreSQL (RDS + pgvector)
 * store. Follows the S3Service constructor-inject pattern but connects LAZILY: the pool is
 * created on first query, never at boot, so an unconfigured or unreachable database can
 * never crash the shared backend process (and thus never take the Campaigns app down).
 */
@Injectable()
export class PgService implements OnModuleDestroy {
  private readonly logger = new Logger(PgService.name);
  private pool?: Pool;

  constructor(private config: ConfigService) {}

  private getPool(): Pool {
    if (this.pool) return this.pool;

    const connectionString = this.config.get("DATABASE_URL");
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not configured — Lex database features are unavailable"
      );
    }

    // RDS terminates TLS with an AWS-managed cert. `rejectUnauthorized: false` accepts it
    // without bundling the RDS CA yet; Phase 1 should pin the RDS CA bundle for verification.
    const sslDisabled = this.config.get("DATABASE_SSL") === "false";

    this.pool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslDisabled ? undefined : { rejectUnauthorized: false }
    });

    // Never let a background pool error crash the process.
    this.pool.on("error", (err) => {
      this.logger.error(
        JSON.stringify({
          level: "error",
          event: "pg:pool_error",
          message: err.message
        })
      );
    });

    return this.pool;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    return this.getPool().query<T>(text, params);
  }

  /** Runs `fn` inside a transaction, committing on success and rolling back on any throw. */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    const res = await this.query<{ ok: number }>("SELECT 1 AS ok");
    return res.rows[0]?.ok === 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
