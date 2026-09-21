/**
 * Integration-test harness. Runs against a real Postgres — the whole point of
 * Phase 2's criterion — and skips itself when there is none, so `pnpm test`
 * stays fast and offline.
 *
 * The database is the suite's own (`database-url.ts`), never the one the app
 * runs on: every suite truncates every table before each test. It is created
 * on first run by `global-setup.ts`.
 */

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type Connection } from "@/server/db/client";
import {
  databaseNameOf,
  resolveTestDatabase,
  withCredentials,
} from "./database-url";

const target = resolveTestDatabase();

export const databaseUrl = target.kind === "ready" ? target.url : "";
export const hasDatabase = databaseUrl.length > 0;

/**
 * The lanes resolve their own pool from the environment (ADR 0002), and inside
 * the suite that has to be the suite's database.
 *
 * `inScope` given a pool opens its transaction on `getDatabase()`, not on the
 * connection it was handed — so without this a converted service called with
 * `connection.db` would read the assertions' rows from one database and write
 * them into the developer's own. Eleven tests found that the hard way.
 */
if (hasDatabase) {
  process.env["APP_DATABASE_URL"] ??= databaseUrl;
  process.env["SYSTEM_DATABASE_URL"] ??= databaseUrl;
}

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

/**
 * The same database, connected as `planora_app` — the role that cannot bypass
 * row-level security (ADR 0002).
 *
 * Everything else in the suite connects as the owner, which is a superuser and
 * therefore exempt from every policy, including the `FORCE` ones. That is what
 * keeps the thirteen existing suites working unchanged; it is also why proving
 * the barrier needs a connection of its own.
 *
 * The migrations create the role without a password, because a migration lives
 * in git. Here it gets a throwaway one, set by the owner, so the test can
 * present it.
 */
export const APP_ROLE = "planora_app";
const APP_PASSWORD = "planora_app_test_only";

export async function connectAsApp(pool = 1): Promise<Connection> {
  const owner = connect(1);
  try {
    await owner.db.execute(
      sql.raw(`alter role ${APP_ROLE} with login password '${APP_PASSWORD}'`),
    );
    await owner.db.execute(
      sql.raw(`grant connect on database "${databaseNameOf(databaseUrl)}" to ${APP_ROLE}`),
    );
  } finally {
    await owner.close();
  }

  return createDatabase(withCredentials(databaseUrl, APP_ROLE, APP_PASSWORD), pool);
}
