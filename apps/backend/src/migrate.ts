import "dotenv/config";
import { join } from "node:path";
import runner from "node-pg-migrate";
import { databaseConfig } from "./shared/database-config";

async function migrate() {
  const direction = process.argv[2] || "up";
  if (direction !== "up" && direction !== "down") {
    throw new Error("Migration direction must be up or down");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await runner({
    databaseUrl: databaseConfig(process.env.DATABASE_URL, {
      ssl: process.env.DATABASE_SSL,
      caFile: process.env.DATABASE_SSL_CA_FILE
    }),
    dir: join(__dirname, "..", "migrations"),
    migrationsTable: "pgmigrations",
    schema: "public",
    checkOrder: true,
    singleTransaction: true,
    direction,
    count: direction === "down" ? 1 : undefined
  });
}

migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
