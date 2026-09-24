import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  APP_ROLE,
  LOCAL_APP_PASSWORD,
  databaseNameOf,
} from "@/server/test-support/database-url";
import { appDatabaseUrl, databaseUrl } from "./database";
import { clearRateLimits } from "./rate-limits";

/**
 * Before the production build serves a single request: the database it will
 * use is migrated, and the rate-limit counters a previous run left behind are
 * cleared (their window is a minute, and they would outlive it).
 *
 * Migrating here is what keeps the suite honest after a schema change. Phase 8
 * added a table, every integration test passed against the integration
 * database, and twenty E2E tests failed at once — the E2E server was pointed
 * at a database nothing had migrated, and every screen that touched the new
 * table fell into the error boundary.
 */
export default async function globalSetup(): Promise<void> {
  await migrateDatabase();
  await letTheApplicationRoleIn();
  await clearRateLimits();
}

async function migrateDatabase(): Promise<void> {
  const sql = postgres(databaseUrl(), { prepare: false, max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "src/server/db/migrations" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * The migrations create `planora_app` without a login, because a migration lives
 * in git; the server under test connects as it (`appDatabaseUrl`), so it gets
 * the local suites' throwaway password here. Nothing is done unless that URL
 * exists — that is, unless the database is on this machine.
 */
async function letTheApplicationRoleIn(): Promise<void> {
  if (!appDatabaseUrl()) return;

  const url = databaseUrl();
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`alter role ${APP_ROLE} with login password '${LOCAL_APP_PASSWORD}'`);
    await sql.unsafe(`grant connect on database "${databaseNameOf(url)}" to ${APP_ROLE}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
