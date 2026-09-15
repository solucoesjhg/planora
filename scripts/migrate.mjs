/**
 * Migrations, run by the pipeline (DEVELOPMENT_PLAN.md §7 Phase 3).
 *
 * Vercel calls this before the build, so the schema is in place before the code
 * that depends on it is serving. Two rules it enforces:
 *
 *   - only a production deployment migrates. A preview build shares the
 *     database it points at, and a branch's half-finished migration is not
 *     something to apply to it on the way past;
 *   - migrations use a session, never the transaction pooler. drizzle-kit
 *     takes an advisory lock and keeps it for the run; transaction mode hands
 *     each statement to whichever backend is free, and the lock is lost.
 *     Supabase's *session pooler* (port 5432 on the pooler host) is the one to
 *     use: the direct host is IPv6-only, and Vercel's builders have no IPv6.
 */

import { spawnSync } from "node:child_process";

const environment = process.env.VERCEL_ENV ?? "local";
const url = process.env.MIGRATION_DATABASE_URL;

if (environment !== "production") {
  console.log(`[migrate] ${environment} deployment — skipped, as designed.`);
  process.exit(0);
}

if (!url) {
  console.error(
    "[migrate] MIGRATION_DATABASE_URL is not set. Production deploys must " +
      "migrate; set it to Supabase's direct connection (port 5432), not the pooler.",
  );
  process.exit(1);
}

if (url.includes("6543") || url.includes("pgbouncer")) {
  console.error(
    "[migrate] MIGRATION_DATABASE_URL points at the pooler. drizzle-kit needs " +
      "a session it keeps: use the direct connection on port 5432.",
  );
  process.exit(1);
}

console.log("[migrate] applying migrations to the production database…");
const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (result.status !== 0 && /db\.[a-z]+\.supabase\.co/.test(url)) {
  // The most likely reason, said out loud: the failure above is usually a
  // connection error, not a migration error.
  console.error(
    "[migrate] MIGRATION_DATABASE_URL points at Supabase's direct host, which " +
      "answers only over IPv6 — and this builder has no IPv6 route. Use the " +
      "session pooler instead: the string on port 5432 whose host ends in " +
      "pooler.supabase.com (docs/DEPLOY.md, 1.4).",
  );
}

process.exit(result.status ?? 1);
