/**
 * Integration-test harness. Runs against a real Postgres — the whole point of
 * Phase 2's criterion — and skips itself when there is none, so `pnpm test`
 * stays fast and offline.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type Connection } from "@/server/db/client";

export const databaseUrl = process.env.DATABASE_URL ?? "";
export const hasDatabase = databaseUrl.length > 0;

export async function connectAndMigrate(pool = 1): Promise<Connection> {
  const connection = connect(pool);
  await migrate(connection.db, {
    migrationsFolder: "src/server/db/migrations",
  });
  return connection;
}

/**
 * Another connection to the same database, already migrated.
 *
 * One pooled connection runs every statement in order, so a test written to
 * make two transactions overlap on it proves nothing: the second waits for the
 * first whether or not the code takes a lock. Anything about concurrency needs
 * connections that are genuinely separate.
 */
export function connect(pool = 1): Connection {
  return createDatabase(databaseUrl, pool);
}
