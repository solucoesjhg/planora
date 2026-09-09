/**
 * Integration-test harness. Runs against a real Postgres — the whole point of
 * Phase 2's criterion — and skips itself when there is none, so `pnpm test`
 * stays fast and offline.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type Connection } from "@/server/db/client";

export const databaseUrl = process.env.DATABASE_URL ?? "";
export const hasDatabase = databaseUrl.length > 0;

export async function connectAndMigrate(): Promise<Connection> {
  const connection = createDatabase(databaseUrl, 1);
  await migrate(connection.db, {
    migrationsFolder: "src/server/db/migrations",
  });
  return connection;
}
