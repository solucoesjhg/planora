/**
 * The restore drill's decisions (DEVELOPMENT_PLAN.md §7 Phase 10).
 *
 * A backup nobody has restored is a rumour. The drill takes a dump, builds a
 * database from nothing but that dump, and counts what came back; this module
 * holds everything it decides before a server is touched — which database it
 * may create and drop, which it must never point at, which flags produce a
 * dump that comes back whole, and whether two row-count manifests agree.
 *
 * Pure on purpose. The runner drops a database every time it runs, so the rule
 * that keeps it away from `planora_dev`, from the integration suite's `_test`
 * databases and from anything that is not on this machine has to be provable
 * without a server. That is the shape of `test-support/database-url.ts`, whose
 * URL surgery this reuses rather than writing a second, slightly different
 * time.
 */

import { ok, refused, type Result } from "@/lib/result";
import {
  databaseNameOf,
  describeDatabase,
  withDatabaseName,
} from "@/server/test-support/database-url";

/** The only database the drill creates, and the only one it drops. */
export const SCRATCH_DATABASE_NAME = "planora_restore_drill";

/** The Postgres from `docker-compose.yml`. Its image carries the client binaries. */
export const LOCAL_POSTGRES_CONTAINER = "planora-db";

/**
 * The image a throwaway client runs from. It matches the local server today;
 * a dump has to be taken by a `pg_dump` at least as new as the server it reads,
 * so a Supabase project on a newer major needs `DRILL_POSTGRES_IMAGE` raised to
 * match — and the restore then runs from the same image, because `pg_restore`
 * cannot read an archive written by a newer one.
 */
export const DEFAULT_POSTGRES_IMAGE = "postgres:17";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type DrillRefusal =
  | "not-configured"
  | "unreadable-url"
  | "not-on-this-machine"
  | "not-the-scratch-database"
  | "source-is-the-scratch-database"
  | "nothing-was-counted"
  | "manifests-differ";

/* ------------------------------------------------------------------ *
 * Which databases the drill may touch
 * ------------------------------------------------------------------ */

/** The database the drill builds from the dump. It is dropped first, every run. */
export type ScratchDatabase = {
  readonly url: string;
  readonly name: string;
};

/**
 * Where the restore goes.
 *
 * `DRILL_SCRATCH_DATABASE_URL` when set — which is what a drill against
 * production needs, since `DATABASE_URL` then names Supabase — otherwise
 * `DATABASE_URL` with the database renamed. Whatever the answer, it has to be
 * a server on this machine and its name has to be the scratch name: the runner
 * drops it before it restores, and a `drop database` is the one statement that
 * has to be wrong only once.
 */
export function resolveScratchDatabase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Result<ScratchDatabase, DrillRefusal> {
  const explicit = env["DRILL_SCRATCH_DATABASE_URL"]?.trim();
  const base = env["DATABASE_URL"]?.trim();
  if (!explicit && !base) {
    return refused(
      "not-configured",
      "Neither DRILL_SCRATCH_DATABASE_URL nor DATABASE_URL is set; the drill has nowhere to restore into.",
    );
  }

  const variable = explicit ? "DRILL_SCRATCH_DATABASE_URL" : "DATABASE_URL";
  const url = explicit || withDatabaseName(base ?? "", SCRATCH_DATABASE_NAME);
  const host = hostOf(url);
  if (!host) {
    return refused("unreadable-url", `${variable} is not a URL this drill can read.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    return refused(
      "not-on-this-machine",
      `${variable} resolves to ${describeDatabase(url)}, which is not on this machine. ` +
        "The drill drops the database it restores into, so it only ever does that here. " +
        `Set DRILL_SCRATCH_DATABASE_URL to the local server with the database named ${SCRATCH_DATABASE_NAME}.`,
    );
  }

  const name = databaseNameOf(url);
  if (!isScratchDatabaseName(name)) {
    return refused("not-the-scratch-database", whyNotScratch(variable, name));
  }
  return ok({ url, name });
}

/**
 * `planora_restore_drill`, or a suffixed one for a drill you want to keep
 * beside the last. Nothing else: not `planora_dev`, not a `_test` database the
 * integration suite owns, not `postgres` itself.
 */
export function isScratchDatabaseName(name: string): boolean {
  return name === SCRATCH_DATABASE_NAME || name.startsWith(`${SCRATCH_DATABASE_NAME}_`);
}

function whyNotScratch(variable: string, name: string): string {
  const named = `${variable} names the database "${name || "(none)"}"`;
  if (name.endsWith("_test")) {
    return `${named}, which belongs to the integration suite. The drill drops the database it restores into; it only drops "${SCRATCH_DATABASE_NAME}".`;
  }
  if (name === "planora_dev") {
    return `${named} — the one the application runs on. The drill drops the database it restores into; it only drops "${SCRATCH_DATABASE_NAME}".`;
  }
  return `${named}. The drill drops the database it restores into, so it only ever points at "${SCRATCH_DATABASE_NAME}" (or a name starting with "${SCRATCH_DATABASE_NAME}_").`;
}

/** The database the dump is taken from. Usually production — that is the point. */
export type SourceDatabase = {
  readonly url: string;
  readonly isLocal: boolean;
  /** Host, port and database, with no password in it. Safe to print. */
  readonly label: string;
};

/**
 * Where the dump comes from: `DRILL_SOURCE_DATABASE_URL`, else `DATABASE_URL`.
 *
 * This one may be remote, and normally is. The single refusal is the drill
 * pointed at its own scratch database, which would restore a copy of the
 * previous run and call that a rehearsal.
 */
export function resolveSourceDatabase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Result<SourceDatabase, DrillRefusal> {
  const explicit = env["DRILL_SOURCE_DATABASE_URL"]?.trim();
  const base = env["DATABASE_URL"]?.trim();
  const url = explicit || base || "";
  if (!url) {
    return refused(
      "not-configured",
      "Neither DRILL_SOURCE_DATABASE_URL nor DATABASE_URL is set; there is nothing to dump.",
    );
  }

  const variable = explicit ? "DRILL_SOURCE_DATABASE_URL" : "DATABASE_URL";
  const host = hostOf(url);
  if (!host) {
    return refused("unreadable-url", `${variable} is not a URL this drill can read.`);
  }
  if (isScratchDatabaseName(databaseNameOf(url))) {
    return refused(
      "source-is-the-scratch-database",
      `${variable} names ${describeDatabase(url)}, the database the drill restores into. Dumping it would rehearse nothing.`,
    );
  }
  return ok({ url, isLocal: LOCAL_HOSTS.has(host), label: describeDatabase(url) });
}

/* ------------------------------------------------------------------ *
 * Where the client runs
 * ------------------------------------------------------------------ */

/**
 * `pg_dump` and `pg_restore` are not installed on this machine — the Postgres
 * they belong to is a container. A dump of the local database runs inside the
 * server's own container; a dump of Supabase runs in a throwaway container,
 * whose image can be raised to match a newer server.
 */
export type Lane =
  | { readonly kind: "running-container"; readonly container: string }
  | { readonly kind: "throwaway-container"; readonly image: string };

export function laneFor(
  source: SourceDatabase,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Lane {
  const image = env["DRILL_POSTGRES_IMAGE"]?.trim();
  if (image) return { kind: "throwaway-container", image };
  return source.isLocal
    ? { kind: "running-container", container: LOCAL_POSTGRES_CONTAINER }
    : { kind: "throwaway-container", image: DEFAULT_POSTGRES_IMAGE };
}

/** Which address the database answers on depends on where the client runs. */
export type PostgresTarget = {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly database: string;
  /** Never becomes an argument: it reaches the client as PGPASSWORD. */
  readonly password: string;
  readonly sslmode: string | null;
};

/**
 * The same database, addressed from inside a container.
 *
 * `127.0.0.1:54322` is the published port, which only exists on the host. A
 * client in the server's own container reaches it at the server's real port;
 * one in a throwaway container reaches the host through Docker's gateway.
 * A remote URL needs none of this and is left alone.
 */
export function targetFor(url: string, lane: Lane): PostgresTarget {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const local = LOCAL_HOSTS.has(host);
  const placed = !local
    ? { host, port }
    : lane.kind === "running-container"
      ? { host: "127.0.0.1", port: "5432" }
      : { host: "host.docker.internal", port };

  return {
    ...placed,
    user: decodeURIComponent(parsed.username) || "postgres",
    password: decodeURIComponent(parsed.password),
    database: databaseNameOf(url),
    // A managed Postgres expects TLS and says so unhelpfully when it does not
    // get it; a container on this machine has none to offer.
    sslmode: parsed.searchParams.get("sslmode") ?? (local ? null : "require"),
  };
}

/* ------------------------------------------------------------------ *
 * The commands
 * ------------------------------------------------------------------ */

export type Command = {
  readonly file: string;
  /** Contains no password: a process list is readable by anyone on the machine. */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

/**
 * The flags that decide whether the dump is worth anything.
 *
 * `--format=custom` so a restore can be selective and does not go through a
 * shell. `--no-owner` and `--no-privileges` because the roles the dump names
 * are Supabase's and do not exist on this machine: without them the restore
 * fails on the first GRANT. The schemas are not listed here — they are read
 * from the source (`schemasToDump`), because a hard-coded list is exactly what
 * goes stale: this drill first ran with `public` and `drizzle` written in, and
 * the migration that added the `app` schema for the RLS policies broke the
 * restore the same week.
 */
const DUMP_FLAGS = ["--format=custom", "--no-owner", "--no-privileges"] as const;

/** One transaction: a restore either lands whole or leaves the scratch empty. */
const RESTORE_FLAGS = ["--no-owner", "--no-privileges", "--single-transaction"] as const;

/**
 * Schemas Postgres and Supabase own. Everything else in the source belongs to
 * this application and goes in the dump — including one added tomorrow.
 *
 * Supabase's own are excluded rather than merely unhelpful: they are owned by
 * roles that do not exist here, half of them carry extensions this database
 * does not have, and `auth` and `storage` are rebuilt by the platform when a
 * project is created. A recovery restores the application's schemas into a new
 * project; it does not restore the project.
 */
const FOREIGN_SCHEMAS = new Set([
  "information_schema",
  "auth",
  "storage",
  "extensions",
  "graphql",
  "graphql_public",
  "realtime",
  "_realtime",
  "_analytics",
  "supabase_migrations",
  "supabase_functions",
  "vault",
  "pgsodium",
  "pgsodium_masks",
  "pgbouncer",
  "cron",
  "net",
]);

/** The application's own schemas, out of everything the source has. */
export function applicationSchemas(names: readonly string[]): readonly string[] {
  return names
    .filter((name) => !name.startsWith("pg_") && !FOREIGN_SCHEMAS.has(name))
    .slice()
    .sort();
}

/**
 * What the dump covers, decided from the source's own schema list.
 *
 * Nothing left is a refusal, not an empty flag list: `pg_dump` with no
 * `--schema` dumps the entire database, and on Supabase that means dumping
 * `auth` and `storage` as well — a dump that cannot be restored, discovered at
 * restore time.
 */
export function schemasToDump(
  names: readonly string[],
): Result<readonly string[], DrillRefusal> {
  const ours = applicationSchemas(names);
  return ours.length === 0
    ? refused(
        "nothing-was-counted",
        "The source database has no schema of its own. Either it is not this application's database, or the connection cannot see its schemas.",
      )
    : ok(ours);
}

export function dumpCommand(
  lane: Lane,
  target: PostgresTarget,
  schemas: readonly string[],
): Command {
  const flags = [...DUMP_FLAGS, ...schemas.map((schema) => `--schema=${schema}`)];
  return dockerCommand(lane, "pg_dump", flags, target, { stdin: false });
}

export function restoreCommand(lane: Lane, target: PostgresTarget): Command {
  return dockerCommand(lane, "pg_restore", RESTORE_FLAGS, target, { stdin: true });
}

function dockerCommand(
  lane: Lane,
  program: string,
  flags: readonly string[],
  target: PostgresTarget,
  options: { readonly stdin: boolean },
): Command {
  const env: Record<string, string> = {};
  if (target.password) env["PGPASSWORD"] = target.password;
  if (target.sslmode) env["PGSSLMODE"] = target.sslmode;

  // `--env NAME` with no value forwards the variable from this process rather
  // than writing it into the command line.
  const forwarded = Object.keys(env).flatMap((name) => ["--env", name]);
  const interactive = options.stdin ? ["--interactive"] : [];

  const docker =
    lane.kind === "running-container"
      ? ["exec", ...interactive, ...forwarded, lane.container]
      : [
          "run",
          "--rm",
          ...interactive,
          ...forwarded,
          // Docker Desktop resolves this to the host; on Linux it needs saying.
          "--add-host=host.docker.internal:host-gateway",
          lane.image,
        ];

  return {
    file: "docker",
    args: [
      ...docker,
      program,
      `--host=${target.host}`,
      `--port=${target.port}`,
      `--username=${target.user}`,
      `--dbname=${target.database}`,
      ...flags,
    ],
    env,
  };
}

/** `planora_dev-2026-09-21T14-30-00.dump` — sortable, and it says what it holds. */
export function dumpFileName(databaseName: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replace(/:/g, "-");
  return `${databaseName || "database"}-${stamp}.dump`;
}

/* ------------------------------------------------------------------ *
 * Did it come back?
 * ------------------------------------------------------------------ */

/**
 * What was counted on each side. Row counts per table, plus the applied
 * migrations, which is the one piece of state that a plausible-looking dump
 * silently leaves behind.
 */
export type Manifest = {
  /** Keyed `schema.table`: the application owns more than `public`. */
  readonly tables: Readonly<Record<string, number>>;
  readonly migrations: readonly string[];
  /**
   * How many row-level security policies the database carries. A restore that
   * brought every row back and no policy would be a database with the barrier
   * missing (§7 Phase 10) — readable, and open.
   */
  readonly policies: number;
};

export type ManifestDifference =
  | { readonly kind: "missing-table"; readonly table: string }
  | { readonly kind: "unexpected-table"; readonly table: string }
  | {
      readonly kind: "row-count";
      readonly table: string;
      readonly taken: number;
      readonly restored: number;
    }
  | { readonly kind: "migrations"; readonly taken: number; readonly restored: number }
  | { readonly kind: "policies"; readonly taken: number; readonly restored: number };

export type DrillMatch = {
  readonly tables: number;
  readonly rows: number;
  readonly migrations: number;
  readonly policies: number;
};

export function manifestDifferences(
  taken: Manifest,
  restored: Manifest,
): readonly ManifestDifference[] {
  const differences: ManifestDifference[] = [];

  for (const table of Object.keys(taken.tables).sort()) {
    const before = taken.tables[table] ?? 0;
    const after = restored.tables[table];
    if (after === undefined) differences.push({ kind: "missing-table", table });
    else if (after !== before) {
      differences.push({ kind: "row-count", table, taken: before, restored: after });
    }
  }

  for (const table of Object.keys(restored.tables).sort()) {
    if (taken.tables[table] === undefined) {
      differences.push({ kind: "unexpected-table", table });
    }
  }

  if (!sameList(taken.migrations, restored.migrations)) {
    differences.push({
      kind: "migrations",
      taken: taken.migrations.length,
      restored: restored.migrations.length,
    });
  }

  if (taken.policies !== restored.policies) {
    differences.push({
      kind: "policies",
      taken: taken.policies,
      restored: restored.policies,
    });
  }

  return differences;
}

/**
 * The answer the drill exists to produce.
 *
 * Two empty manifests are equal, so emptiness is refused before equality is
 * even asked: a source that reported no table, or no applied migration, was
 * read through something other than the database the application uses, and
 * comparing it to the restore proves nothing at all.
 */
export function compareManifests(
  taken: Manifest,
  restored: Manifest,
): Result<DrillMatch, DrillRefusal> {
  if (Object.keys(taken.tables).length === 0) {
    return refused(
      "nothing-was-counted",
      "The source database reported no tables. Two empty manifests match, which is why this is refused rather than reported as a success.",
    );
  }
  if (taken.migrations.length === 0) {
    return refused(
      "nothing-was-counted",
      "The source database reported no applied migrations. Either drizzle.__drizzle_migrations is missing, or the dump was taken from somewhere that is not the application's database.",
    );
  }

  const differences = manifestDifferences(taken, restored);
  if (differences.length > 0) {
    return refused("manifests-differ", differences.map(describeDifference).join("\n"));
  }

  return ok({
    tables: Object.keys(taken.tables).length,
    rows: totalRows(taken),
    migrations: taken.migrations.length,
    policies: taken.policies,
  });
}

export function describeDifference(difference: ManifestDifference): string {
  switch (difference.kind) {
    case "missing-table":
      return `${difference.table}: in the source, not in the restore`;
    case "unexpected-table":
      return `${difference.table}: in the restore, not in the source`;
    case "row-count":
      return `${difference.table}: ${difference.taken} rows dumped, ${difference.restored} restored`;
    case "migrations":
      return `applied migrations: ${difference.taken} in the source, ${difference.restored} in the restore — the dump did not bring the drizzle schema back`;
    case "policies":
      return `row-level security policies: ${difference.taken} in the source, ${difference.restored} in the restore — the restored database is open`;
  }
}

export function totalRows(manifest: Manifest): number {
  return Object.values(manifest.tables).reduce((total, rows) => total + rows, 0);
}

/* ------------------------------------------------------------------ *
 * The record a drill leaves behind
 * ------------------------------------------------------------------ */

/**
 * Fills `docs/restore-drills/TEMPLATE.md`. Placeholders with no value are left
 * as they are: the template asks questions only the person running the drill
 * can answer, and a blank is more honest than a guess.
 */
export function renderDrillRecord(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
    key in values ? (values[key] ?? placeholder) : placeholder,
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
