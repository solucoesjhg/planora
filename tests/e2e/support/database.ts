import postgres from "postgres";

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
