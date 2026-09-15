import postgres from "postgres";
import { databaseUrl } from "./database";

/**
 * The rate limiter is real and stays on in every environment (§7 Phase 10), so
 * a suite that signs up seven times in a minute would fight it: sign-up allows
 * five. Tests get a clean counter rather than a weakened limit — the rule under
 * test in production is the rule running here.
 */
export async function clearRateLimits(): Promise<void> {
  const sql = postgres(databaseUrl(), { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`truncate table rate_limits`;
  } catch {
    // The table arrives with the first migration; a fresh database has none.
  } finally {
    await sql.end({ timeout: 5 });
  }
}
