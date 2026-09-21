/**
 * The restore drill (DEVELOPMENT_PLAN.md §7 Phase 10; docs/DEPLOY.md §6).
 *
 * Takes a dump, builds a database from nothing but that dump, counts both
 * sides and says whether the backup is real. Every decision it makes — which
 * database it may drop, which flags the dump needs, whether the manifests
 * agree — lives in `src/server/db/restore-drill.ts`, where it is unit-tested;
 * this file is the part that talks to Docker and to Postgres.
 *
 *   pnpm db:restore-drill                      the local database, as a rehearsal
 *   pnpm db:restore-drill --record             and leave a dated record behind
 *
 * A drill against production needs its own two variables, because
 * `DATABASE_URL` then names Supabase and the restore must still land here:
 *
 *   DRILL_SOURCE_DATABASE_URL   the session pooler string (port 5432)
 *   DRILL_SCRATCH_DATABASE_URL  postgresql://postgres:postgres@127.0.0.1:54322/planora_restore_drill
 *
 * `pg_dump` is not installed on this machine: it lives in the Postgres image,
 * so every dump and restore runs through Docker.
 */

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { isRefused, ok, refused, type Result } from "@/lib/result";
import { maintenanceUrl } from "@/server/test-support/database-url";
import {
  applicationSchemas,
  compareManifests,
  dumpCommand,
  dumpFileName,
  laneFor,
  renderDrillRecord,
  resolveScratchDatabase,
  resolveSourceDatabase,
  restoreCommand,
  schemasToDump,
  targetFor,
  totalRows,
  type Command,
  type DrillMatch,
  type DrillRefusal,
  type Lane,
  type Manifest,
  type ScratchDatabase,
  type SourceDatabase,
} from "@/server/db/restore-drill";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RECORDS = join(ROOT, "docs", "restore-drills");
const TEMPLATE = join(RECORDS, "TEMPLATE.md");

export type DrillOptions = {
  readonly source: SourceDatabase;
  readonly scratch: ScratchDatabase;
  readonly lane: Lane;
  /** Where the dump file lands. The command passes `backups/`, which is git-ignored. */
  readonly directory: string;
  readonly now?: Date;
  readonly log?: (line: string) => void;
};

export type DrillReport = {
  readonly source: string;
  readonly scratch: string;
  readonly dumpPath: string;
  readonly bytes: number;
  readonly taken: Manifest;
  readonly restored: Manifest;
  readonly match: DrillMatch;
  readonly seconds: number;
};

export type DrillFailure = DrillRefusal | "dump-failed" | "restore-failed";

/**
 * Dump, restore, count, compare.
 *
 * The scratch database is dropped and recreated first, and its `public` schema
 * is dropped with it: the restore then has to build every schema it needs, so
 * an object the dump left out fails here instead of being quietly supplied by
 * a database that was not empty after all.
 */
export async function runDrill(
  options: DrillOptions,
): Promise<Result<DrillReport, DrillFailure>> {
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  const at = options.now ?? new Date();

  const sourceTarget = targetFor(options.source.url, options.lane);
  const scratchTarget = targetFor(options.scratch.url, options.lane);

  log(`[drill] source  ${options.source.label}`);
  log(`[drill] scratch ${options.scratch.name} on this machine`);
  log(
    `[drill] client  ${
      options.lane.kind === "running-container"
        ? `pg_dump inside the ${options.lane.container} container`
        : `pg_dump from a throwaway ${options.lane.image} container`
    }`,
  );

  const schemas = schemasToDump(await readApplicationSchemas(options.source.url));
  if (isRefused(schemas)) return schemas;
  log(`[drill] schemas ${schemas.value.join(", ")}`);

  log("[drill] counting the source…");
  const taken = await takeManifest(options.source.url);
  log(
    `[drill] ${Object.keys(taken.tables).length} tables, ${totalRows(taken)} rows, ${taken.migrations.length} migrations applied, ${taken.policies} policies.`,
  );

  await mkdir(options.directory, { recursive: true });
  const dumpPath = join(options.directory, dumpFileName(sourceTarget.database, at));

  log(`[drill] dumping into ${dumpPath} …`);
  const dump = await execute(dumpCommand(options.lane, sourceTarget, schemas.value), {
    stdout: createWriteStream(dumpPath),
  });
  if (dump.code !== 0) {
    return refused("dump-failed", `pg_dump exited ${dump.code}.\n${dump.stderr.trim()}`);
  }
  const bytes = (await stat(dumpPath)).size;
  log(`[drill] ${bytes.toLocaleString("en-US")} bytes.`);

  log(`[drill] rebuilding ${options.scratch.name} …`);
  await recreateScratchDatabase(options.scratch);

  log("[drill] restoring…");
  const restore = await execute(restoreCommand(options.lane, scratchTarget), {
    stdin: createReadStream(dumpPath),
  });
  if (restore.code !== 0) {
    return refused("restore-failed", `pg_restore exited ${restore.code}.\n${restore.stderr.trim()}`);
  }

  log("[drill] counting the restore…");
  const restored = await takeManifest(options.scratch.url);

  const match = compareManifests(taken, restored);
  if (isRefused(match)) return match;

  return ok({
    source: options.source.label,
    scratch: options.scratch.name,
    dumpPath,
    bytes,
    taken,
    restored,
    match: match.value,
    seconds: Math.round((Date.now() - startedAt) / 100) / 10,
  });
}

/**
 * Every table the application owns with its row count, the migrations the
 * database believes it has applied, and how many policies guard it.
 *
 * Read over an ordinary connection, which is the point: it is the
 * application's own view of the database, not the dump file's account of
 * itself.
 */
export async function takeManifest(url: string): Promise<Manifest> {
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    // Each side is asked what it has, rather than the restore being counted
    // through the source's list: a schema that did not survive the restore
    // should come back as tables that are missing, not as tables nobody looked
    // for.
    const schemas = applicationSchemas(await schemaNames(sql));

    const tables = await sql<{ schema: string; name: string }[]>`
      select table_schema as schema, table_name as name
      from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema = any(${schemas})
      order by table_schema, table_name
    `;

    const counts: Record<string, number> = {};
    for (const { schema, name } of tables) {
      const [row] = await sql<{ rows: number }[]>`
        select count(*)::int as rows from ${sql(schema)}.${sql(name)}
      `;
      counts[`${schema}.${name}`] = row?.rows ?? 0;
    }

    let migrations: string[] = [];
    try {
      const rows = await sql<{ hash: string }[]>`
        select hash from drizzle.__drizzle_migrations order by created_at, id
      `;
      migrations = rows.map((row) => row.hash);
    } catch {
      // No drizzle schema: the restore lost it, and the comparison will say so.
    }

    const [policies] = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_policies where schemaname = any(${schemas})
    `;

    return { tables: counts, migrations, policies: policies?.count ?? 0 };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Every schema the connection can see, for `applicationSchemas` to sort out. */
async function schemaNames(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select nspname as name from pg_namespace order by nspname
  `;
  return rows.map((row) => row.name);
}

/** What the dump has to cover, asked of the source rather than remembered. */
export async function readApplicationSchemas(url: string): Promise<readonly string[]> {
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    return applicationSchemas(await schemaNames(sql));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Drops it if it is there, creates it empty, and empties it further. */
async function recreateScratchDatabase(scratch: ScratchDatabase): Promise<void> {
  const admin = postgres(maintenanceUrl(scratch.url), {
    prepare: false,
    max: 1,
    onnotice: () => {},
  });
  try {
    // `with (force)` closes whatever is still connected — a psql left open in
    // another window should not be able to fail the drill.
    await admin`drop database if exists ${admin(scratch.name)} with (force)`;
    await admin`create database ${admin(scratch.name)}`;
  } finally {
    await admin.end({ timeout: 5 });
  }

  const fresh = postgres(scratch.url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    // The dump carries `create schema public`, and a brand-new database
    // already has one. Dropping it is what makes the restore build the
    // database rather than land in one.
    await fresh`drop schema if exists public cascade`;
  } finally {
    await fresh.end({ timeout: 5 });
  }
}

type Execution = { readonly code: number; readonly stderr: string };

function execute(
  command: Command,
  io: { stdout?: NodeJS.WritableStream; stdin?: NodeJS.ReadableStream } = {},
): Promise<Execution> {
  const child = spawn(command.file, [...command.args], {
    env: { ...process.env, ...command.env },
    stdio: [io.stdin ? "pipe" : "ignore", io.stdout ? "pipe" : "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const pumped =
    io.stdout && child.stdout ? pipeline(child.stdout, io.stdout) : Promise.resolve();
  // A client that exits early breaks the pipe; its exit code is the real news.
  const fed =
    io.stdin && child.stdin
      ? pipeline(io.stdin, child.stdin).catch(() => {})
      : Promise.resolve();

  return new Promise<Execution>((settle, fail) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      fail(
        error.code === "ENOENT"
          ? new Error(`${command.file} is not on the PATH; the drill runs pg_dump through Docker.`)
          : error,
      );
    });
    child.on("close", (code) => {
      void Promise.all([pumped, fed]).then(
        () => settle({ code: code ?? 1, stderr }),
        (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}

/* ------------------------------------------------------------------ *
 * The command line
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const wantsRecord = process.argv.includes("--record");

  const source = resolveSourceDatabase();
  if (isRefused(source)) return fail(source.reason, source.detail);
  const scratch = resolveScratchDatabase();
  if (isRefused(scratch)) return fail(scratch.reason, scratch.detail);

  const at = new Date();
  const result = await runDrill({
    source: source.value,
    scratch: scratch.value,
    lane: laneFor(source.value),
    directory: join(ROOT, "backups"),
    now: at,
    log: (line) => console.log(line),
  });

  if (isRefused(result)) return fail(result.reason, result.detail);

  const report = result.value;
  console.log("");
  console.log(`[drill] The backup is real. ${report.source} → ${report.scratch}`);
  console.log(
    `[drill] ${report.match.tables} tables, ${report.match.rows} rows, ${report.match.migrations} migrations and ${report.match.policies} policies came back identical, in ${report.seconds}s.`,
  );
  console.log(`[drill] The dump is at ${report.dumpPath} — it is git-ignored, and it is a copy of`);
  console.log("[drill] everything in the database. Delete it when you are done with it.");

  if (wantsRecord) console.log(`[drill] Record written to ${await writeRecord(report, at)}`);
  else console.log("[drill] Run with --record to leave a dated record in docs/restore-drills/.");
}

function fail(reason: string, detail?: string): void {
  console.error(`[drill] refused: ${reason}`);
  if (detail) console.error(`[drill] ${detail}`);
  process.exitCode = 1;
}

/** The template, filled with what the run knows. The rest is for the person. */
async function writeRecord(report: DrillReport, at: Date): Promise<string> {
  const date = at.toISOString().slice(0, 10);
  // Named for what was restored, not for where it landed: `2026-09-21-postgres.md`
  // is the production drill, `…-planora_dev.md` the local rehearsal.
  const restored = report.source.split("/").pop()?.replace(/[^a-z0-9_-]/gi, "") || "drill";
  const path = join(RECORDS, `${date}-${restored}.md`);
  const template = await readFile(TEMPLATE, "utf8");

  const filled = renderDrillRecord(template, {
    date,
    source: report.source,
    scratch: report.scratch,
    dump: `${report.dumpPath} (${report.bytes.toLocaleString("en-US")} bytes)`,
    tables: String(report.match.tables),
    rows: String(report.match.rows),
    migrations: String(report.match.migrations),
    policies: String(report.match.policies),
    seconds: String(report.seconds),
    result: "matched — every table, every row count, every applied migration",
  });

  await writeFile(path, filled, { encoding: "utf8", flag: "wx" }).catch((error: unknown) => {
    // A second drill on the same day should not overwrite the first one's notes.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    console.error(`[drill] ${path} already exists; the report above was not written to it.`);
  });

  return path;
}

/**
 * Only when run as the command. The integration test imports this module and
 * drives `runDrill` itself, with the suite's own database as the source.
 */
const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(`[drill] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
