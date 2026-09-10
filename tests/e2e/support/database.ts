import postgres from "postgres";

/**
 * A read straight into the database, for the few assertions that are about
 * something the interface does not show.
 */
export async function query<T>(
  run: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required for this assertion");

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
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
