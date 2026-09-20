/**
 * Once, before the first integration suite (vitest.integration.config.mts):
 * decide which database the run may use, say so, and create it if the server
 * does not have it yet.
 *
 * A configured database the suite may not truncate fails the run here rather
 * than letting every suite skip and the run come out green.
 */

import postgres from "postgres";
import {
  databaseNameOf,
  describeDatabase,
  maintenanceUrl,
  resolveTestDatabase,
} from "./database-url";

export default async function setup(): Promise<void> {
  const target = resolveTestDatabase();
  if (target.kind === "none") {
    console.warn(
      "[test:db] Neither TEST_DATABASE_URL nor DATABASE_URL is set; every integration suite will be skipped.",
    );
    return;
  }
  if (target.kind === "refused") {
    throw new Error(
      `[test:db] Refusing to run: ${target.reason}. Set TEST_DATABASE_URL to a database on this machine whose name ends in _test.`,
    );
  }
  await ensureDatabaseExists(target.url);
  console.info(`[test:db] Running against ${describeDatabase(target.url)}.`);
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const name = databaseNameOf(url);
  const sql = postgres(maintenanceUrl(url), {
    prepare: false,
    max: 1,
    onnotice: () => {},
  });
  try {
    const [row] = await sql`select 1 as one from pg_database where datname = ${name}`;
    if (!row) {
      await sql`create database ${sql(name)}`;
      console.info(`[test:db] Created the database "${name}".`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
