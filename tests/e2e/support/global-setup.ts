import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl } from "./database";
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
