import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientConfig } from "pg";

/** Shared by the API and migrations so both verify the database certificate and hostname. */
export function databaseConfig(
  connectionString: string,
  options: { ssl?: string; caFile?: string } = {}
): ClientConfig {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }

  // pg-connection-string otherwise replaces the explicit ssl object with URL settings.
  for (const key of [
    "ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"
  ]) {
    url.searchParams.delete(key);
  }

  if (options.ssl === "false") {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (process.env.NODE_ENV === "production" || !local) {
      throw new Error("DATABASE_SSL=false is only allowed for local development");
    }
    return { connectionString: url.toString(), ssl: false };
  }
  if (options.ssl !== undefined && options.ssl !== "true") {
    throw new Error("DATABASE_SSL must be true or false");
  }

  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(
        options.caFile || join(__dirname, "certs", "eu-north-1-bundle.pem"),
        "utf8"
      )
    }
  };
}
