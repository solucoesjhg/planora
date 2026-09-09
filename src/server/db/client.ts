/**
 * The database connection (DEVELOPMENT_PLAN.md §5, §9).
 *
 * Drizzle speaks the Postgres wire protocol through Supabase's pooler in
 * transaction mode, which is why prepared statements are off: a pooled
 * connection is not the same session twice.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything a repository can run a query on: the pool or an open transaction. */
export type Executor = Database | Transaction;

export type Connection = {
  readonly db: Database;
  readonly close: () => Promise<void>;
};

export function createDatabase(url: string, max = 5): Connection {
  const sql = postgres(url, { prepare: false, max, onnotice: () => {} });
  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}

let connection: Connection | null = null;

/** The process-wide connection. Server-only callers arrive in Phase 3. */
export function getDatabase(): Database {
  if (connection) return connection.db;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  connection = createDatabase(url);
  return connection.db;
}
