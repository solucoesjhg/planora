import postgres from "postgres";
import {
  APP_ROLE,
  LOCAL_APP_PASSWORD,
  isLocal,
  withCredentials,
} from "@/server/test-support/database-url";

/**
 * The database the suite runs against when nothing says otherwise — the same
 * one the production server under test is pointed at (playwright.config.ts),
 * so an assertion that reads the database reads the one the screen wrote to.
 */
export const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/planora_dev";

export function databaseUrl(): string {
  return process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL;
}

/**
 * The same database as `planora_app`, which is what the server under test
 * connects as — the role production uses, subject to every policy (ADR 0002).
 * With the owner instead, the barrier is inert, and a policy that refuses a
 * real flow passes every test: accepting an invitation failed in production for
 * two days that way (ADR 0003).
 *
 * Only on this machine, because the password is in git. Against anything else
 * the answer is null and the server connects as whatever `DATABASE_URL` says.
 */
export function appDatabaseUrl(): string | null {
  const url = databaseUrl();
  return isLocal(url) ? withCredentials(url, APP_ROLE, LOCAL_APP_PASSWORD) : null;
}

/**
 * A read straight into the database, for the few assertions that are about
 * something the interface does not show.
 */
export async function query<T>(
  run: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(databaseUrl(), { prepare: false, max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** How many activity entries exist — the far end of the outbox. */
export async function activityCount(): Promise<number> {
  const [row] = await query((sql) =>
    sql<{ n: number }[]>`select count(*)::int as n from activity_logs`,
  );
  return row?.n ?? 0;
}

export async function pendingEventCount(): Promise<number> {
  const [row] = await query((sql) =>
    sql<
      { n: number }[]
    >`select count(*)::int as n from outbox_events where processed_at is null`,
  );
  return row?.n ?? 0;
}
