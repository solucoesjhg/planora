/**
 * The drill, rehearsed locally on every `pnpm test:db`.
 *
 * It dumps the suite's own seeded database, builds a scratch database from
 * that dump and compares the two — the same code path `pnpm db:restore-drill`
 * runs against production, with no Supabase credential anywhere near it. This
 * is the test that catches a wrong `pg_dump` flag before a production dump is
 * ever taken: a dump without the `drizzle` schema, or a restore that lands
 * short of rows, fails here.
 *
 * It needs the local Postgres container, because `pg_dump` is not installed on
 * this machine — the client binaries live in the image. No container, no
 * database, no run.
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRefused, type Result } from "@/lib/result";
import type { Connection } from "@/server/db/client";
import { connectAndMigrate, databaseUrl, hasDatabase } from "@/server/test-support/database";
import {
  describeDatabase,
  maintenanceUrl,
  withDatabaseName,
} from "@/server/test-support/database-url";
import { runDrill, takeManifest, type DrillReport } from "../../../scripts/restore-drill";
import {
  LOCAL_POSTGRES_CONTAINER,
  SCRATCH_DATABASE_NAME,
  compareManifests,
  resolveScratchDatabase,
  resolveSourceDatabase,
  type Lane,
} from "./restore-drill";
import { seed } from "./seed";

/** Its own scratch database, so a drill run by hand is not thrown away by a test. */
const SCRATCH = `${SCRATCH_DATABASE_NAME}_suite`;

const suite = describe.skipIf(!hasDatabase || !containerIsRunning());

suite("the restore drill", () => {
  const lane: Lane = { kind: "running-container", container: LOCAL_POSTGRES_CONTAINER };
  const scratchUrl = withDatabaseName(databaseUrl, SCRATCH);

  let connection: Connection;
  let directory: string;
  let report: DrillReport;

  beforeAll(async () => {
    connection = await connectAndMigrate();
    await seed(connection.db);
    directory = await mkdtemp(join(tmpdir(), "planora-drill-"));

    const source = unwrap(resolveSourceDatabase({ DATABASE_URL: databaseUrl }));
    const scratch = unwrap(resolveScratchDatabase({ DRILL_SCRATCH_DATABASE_URL: scratchUrl }));
    expect(source.label).toBe(describeDatabase(databaseUrl));
    expect(scratch.name).toBe(SCRATCH);

    report = unwrap(await runDrill({ source, scratch, lane, directory }));
  }, 180_000);

  afterAll(async () => {
    await connection?.close();
    await dropScratchDatabase();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("writes a dump with something in it", async () => {
    expect(report.bytes).toBeGreaterThan(1_000);
    expect((await stat(report.dumpPath)).size).toBe(report.bytes);
  });

  it("brings every table back, row for row", () => {
    expect(report.restored.tables).toEqual(report.taken.tables);
    // The seed's twenty cards are the ones that have to be there.
    expect(report.restored.tables["public.tasks"]).toBe(20);
    expect(report.match.tables).toBeGreaterThanOrEqual(20);
    expect(report.match.rows).toBe(
      Object.values(report.taken.tables).reduce((total, rows) => total + rows, 0),
    );
  });

  it("brings the migration state back, which a dump of `public` alone would not", () => {
    expect(report.restored.migrations).toEqual(report.taken.migrations);
    expect(report.match.migrations).toBeGreaterThan(0);
  });

  it("restores data the application can read, not just rows that count the same", async () => {
    const sql = postgres(scratchUrl, { prepare: false, max: 1, onnotice: () => {} });
    try {
      const [board] = await sql<{ project: string; cards: number }[]>`
        select p.name as project, count(t.id)::int as cards
        from projects p join tasks t on t.project_id = p.id
        group by p.name order by p.name limit 1
      `;
      expect(board?.cards).toBeGreaterThan(0);

      const [person] = await sql<{ email: string }[]>`select email from users limit 1`;
      expect(person?.email).toContain("@");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("would notice a restore that came up short", async () => {
    const sql = postgres(scratchUrl, { prepare: false, max: 1, onnotice: () => {} });
    try {
      await sql`delete from task_checklist_items`;
    } finally {
      await sql.end({ timeout: 5 });
    }

    // The same comparison the drill makes, against a database that lost rows
    // after the restore: this is the failure the drill exists to produce.
    const damaged = await takeManifest(scratchUrl);
    const result = compareManifests(report.taken, damaged);
    expect(result).toMatchObject({ reason: "manifests-differ" });
    expect(result).toMatchObject({
      detail: expect.stringContaining("task_checklist_items"),
    });
  }, 60_000);
});

function unwrap<Value>(result: Result<Value, string>): Value {
  if (isRefused(result)) {
    throw new Error(`the drill refused: ${result.reason} — ${result.detail ?? ""}`);
  }
  return result.value;
}

async function dropScratchDatabase(): Promise<void> {
  const admin = postgres(maintenanceUrl(withDatabaseName(databaseUrl, SCRATCH)), {
    prepare: false,
    max: 1,
    onnotice: () => {},
  });
  try {
    await admin`drop database if exists ${admin(SCRATCH)} with (force)`;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** `pg_dump` lives in the container; without it there is nothing to rehearse. */
function containerIsRunning(): boolean {
  try {
    const state = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.Running}}", LOCAL_POSTGRES_CONTAINER],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return state.trim() === "true";
  } catch {
    return false;
  }
}
