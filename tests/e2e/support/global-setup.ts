import postgres from "postgres";

/**
 * The rate limiter is real and stays on in every environment (§7 Phase 10), so
 * a suite that signs up four times in a second would fight it — and the leftover
 * counters from the previous run too, since the window is a minute. Tests get a
 * clean counter rather than a weakened limit.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) return;

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`truncate table rate_limits`;
  } catch {
    // The table arrives with the first migration; a fresh database has none.
  } finally {
    await sql.end({ timeout: 5 });
  }
}
