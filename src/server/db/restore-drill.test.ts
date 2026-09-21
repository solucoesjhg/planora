import { describe, expect, it } from "vitest";
import {
  SCRATCH_DATABASE_NAME,
  applicationSchemas,
  compareManifests,
  dumpCommand,
  dumpFileName,
  laneFor,
  manifestDifferences,
  renderDrillRecord,
  resolveScratchDatabase,
  resolveSourceDatabase,
  restoreCommand,
  schemasToDump,
  targetFor,
  type Lane,
  type Manifest,
} from "./restore-drill";

const local = "postgresql://postgres:postgres@127.0.0.1:54322/planora_dev";
const production =
  "postgresql://postgres.abcdefgh:s3cr3t@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

const inTheServer: Lane = { kind: "running-container", container: "planora-db" };
const throwaway: Lane = { kind: "throwaway-container", image: "postgres:18" };

describe("the database the drill restores into", () => {
  it("is DATABASE_URL's server with the scratch name", () => {
    expect(resolveScratchDatabase({ DATABASE_URL: local })).toEqual({
      kind: "ok",
      value: {
        url: `postgresql://postgres:postgres@127.0.0.1:54322/${SCRATCH_DATABASE_NAME}`,
        name: SCRATCH_DATABASE_NAME,
      },
    });
  });

  it("is nothing when nothing is configured", () => {
    expect(resolveScratchDatabase({})).toMatchObject({ reason: "not-configured" });
  });

  it("is never the application's own database", () => {
    const result = resolveScratchDatabase({ DRILL_SCRATCH_DATABASE_URL: local });
    expect(result).toMatchObject({ reason: "not-the-scratch-database" });
    expect(result).toMatchObject({ detail: expect.stringContaining("planora_dev") });
  });

  it("is never a database the integration suite owns", () => {
    const result = resolveScratchDatabase({
      DRILL_SCRATCH_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/planora_test",
    });
    expect(result).toMatchObject({ reason: "not-the-scratch-database" });
    expect(result).toMatchObject({ detail: expect.stringContaining("integration suite") });
  });

  it("is never the server's own postgres database", () => {
    expect(
      resolveScratchDatabase({
        DRILL_SCRATCH_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      }),
    ).toMatchObject({ reason: "not-the-scratch-database" });
  });

  it("is never production, even when DATABASE_URL is production", () => {
    const result = resolveScratchDatabase({ DATABASE_URL: production });
    expect(result).toMatchObject({ reason: "not-on-this-machine" });
    expect(result).toMatchObject({
      detail: expect.stringContaining("pooler.supabase.com"),
    });
    // The refusal is printed and pasted into a drill record; the password is not.
    expect(JSON.stringify(result)).not.toContain("s3cr3t");
  });

  it("refuses what it cannot read", () => {
    expect(resolveScratchDatabase({ DATABASE_URL: "not a url" })).toMatchObject({
      reason: "unreadable-url",
    });
  });

  it("allows a suffixed scratch database, so last week's drill can be kept", () => {
    expect(
      resolveScratchDatabase({
        DRILL_SCRATCH_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:54322/${SCRATCH_DATABASE_NAME}_2026_09_21`,
      }),
    ).toMatchObject({ kind: "ok" });
  });
});

describe("the database the drill dumps", () => {
  it("is production when that is what DATABASE_URL names, and says so without the password", () => {
    const result = resolveSourceDatabase({ DATABASE_URL: production });
    expect(result).toMatchObject({
      kind: "ok",
      value: { isLocal: false, label: "aws-0-sa-east-1.pooler.supabase.com:6543/postgres" },
    });
  });

  it("is never the scratch database, which would rehearse nothing", () => {
    expect(
      resolveSourceDatabase({
        DRILL_SOURCE_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:54322/${SCRATCH_DATABASE_NAME}`,
      }),
    ).toMatchObject({ reason: "source-is-the-scratch-database" });
  });

  it("is nothing when nothing is configured", () => {
    expect(resolveSourceDatabase({})).toMatchObject({ reason: "not-configured" });
  });
});

describe("where the client runs", () => {
  it("is the server's own container for a local dump", () => {
    const source = { url: local, isLocal: true, label: "127.0.0.1:54322/planora_dev" };
    expect(laneFor(source, {})).toEqual({ kind: "running-container", container: "planora-db" });
  });

  it("is a throwaway container for a remote dump, or whenever an image is named", () => {
    const remote = { url: production, isLocal: false, label: "supabase" };
    expect(laneFor(remote, {})).toMatchObject({ kind: "throwaway-container" });
    expect(laneFor({ ...remote, isLocal: true }, { DRILL_POSTGRES_IMAGE: "postgres:18" })).toEqual({
      kind: "throwaway-container",
      image: "postgres:18",
    });
  });

  it("reaches a local database at the server's real port from inside the server", () => {
    expect(targetFor(local, inTheServer)).toEqual({
      host: "127.0.0.1",
      port: "5432",
      user: "postgres",
      password: "postgres",
      database: "planora_dev",
      sslmode: null,
    });
  });

  it("reaches a local database through the Docker gateway from a throwaway container", () => {
    expect(targetFor(local, throwaway)).toMatchObject({
      host: "host.docker.internal",
      port: "54322",
    });
  });

  it("leaves a remote database alone, and asks for TLS", () => {
    expect(targetFor(production, throwaway)).toMatchObject({
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: "6543",
      user: "postgres.abcdefgh",
      database: "postgres",
      sslmode: "require",
    });
  });
});

describe("which schemas the dump covers", () => {
  // What a Supabase project actually answers with, plus ours.
  const onSupabase = [
    "app",
    "auth",
    "cron",
    "drizzle",
    "extensions",
    "graphql",
    "graphql_public",
    "net",
    "pg_catalog",
    "pg_toast",
    "information_schema",
    "public",
    "realtime",
    "storage",
    "vault",
  ];

  it("is everything the application owns, and nothing of Supabase's", () => {
    expect(applicationSchemas(onSupabase)).toEqual(["app", "drizzle", "public"]);
  });

  it("is read from the source, so a schema added by a migration is never forgotten", () => {
    // `app` arrived with the RLS policies, and a hard-coded list did not have it.
    expect(applicationSchemas([...onSupabase, "reports"])).toContain("reports");
  });

  it("is refused when there is nothing of ours: pg_dump with no --schema dumps the lot", () => {
    expect(schemasToDump(["auth", "storage", "pg_catalog"])).toMatchObject({
      reason: "nothing-was-counted",
    });
  });
});

describe("the commands", () => {
  const command = dumpCommand(throwaway, targetFor(production, throwaway), [
    "app",
    "drizzle",
    "public",
  ]);

  it("dump every schema they were given, and no other", () => {
    expect(command.args).toContain("--schema=app");
    expect(command.args).toContain("--schema=public");
    // Without this the restore comes back looking complete and having applied
    // no migration in its life.
    expect(command.args).toContain("--schema=drizzle");
    expect(command.args.filter((arg) => arg.startsWith("--schema="))).toHaveLength(3);
    expect(command.args).toContain("--format=custom");
    expect(command.args).toContain("--no-owner");
    expect(command.args).toContain("--no-privileges");
  });

  it("keep the password out of the process list", () => {
    expect(command.args.join(" ")).not.toContain("s3cr3t");
    expect(command.env).toEqual({ PGPASSWORD: "s3cr3t", PGSSLMODE: "require" });
    // `--env NAME` forwards it from this process instead.
    expect(command.args).toEqual(
      expect.arrayContaining(["--env", "PGPASSWORD", "--env", "PGSSLMODE"]),
    );
  });

  it("restore inside one transaction, so a half-restore is not mistaken for one", () => {
    const restore = restoreCommand(inTheServer, targetFor(local, inTheServer));
    expect(restore.args).toContain("--single-transaction");
    expect(restore.args).toContain("pg_restore");
    // pg_restore reads the archive from stdin.
    expect(restore.args).toContain("--interactive");
    expect(restore.args.slice(0, 2)).toEqual(["exec", "--interactive"]);
  });

  it("run a throwaway container that can reach the host", () => {
    expect(command.args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(command.args).toContain("--add-host=host.docker.internal:host-gateway");
    expect(command.args).toContain("postgres:18");
  });
});

describe("the dump file", () => {
  it("is named for the database and the moment, and sorts by date", () => {
    expect(dumpFileName("postgres", new Date("2026-09-21T14:30:00.000Z"))).toBe(
      "postgres-2026-09-21T14-30-00.dump",
    );
  });
});

describe("comparing the manifests", () => {
  const taken: Manifest = {
    tables: {
      "public.tasks": 20,
      "public.projects": 2,
      "public.users": 1,
      "public.outbox_events": 0,
    },
    migrations: ["a", "b"],
    policies: 25,
  };

  it("says how much came back when everything did", () => {
    expect(compareManifests(taken, { ...taken })).toEqual({
      kind: "ok",
      value: { tables: 4, rows: 23, migrations: 2, policies: 25 },
    });
  });

  it("refuses a restore that is short of rows, and names the table", () => {
    const restored: Manifest = {
      ...taken,
      tables: { ...taken.tables, "public.tasks": 19 },
    };
    const result = compareManifests(taken, restored);
    expect(result).toMatchObject({ reason: "manifests-differ" });
    expect(result).toMatchObject({
      detail: expect.stringContaining("public.tasks: 20 rows dumped, 19"),
    });
  });

  it("refuses a restore missing a table", () => {
    const restored: Manifest = {
      ...taken,
      tables: { "public.tasks": 20, "public.projects": 2, "public.users": 1 },
    };
    expect(manifestDifferences(taken, restored)).toEqual([
      { kind: "missing-table", table: "public.outbox_events" },
    ]);
  });

  it("refuses a restore that came back without its policies, barrier and all", () => {
    const result = compareManifests(taken, { ...taken, policies: 0 });
    expect(result).toMatchObject({ reason: "manifests-differ" });
    expect(result).toMatchObject({ detail: expect.stringContaining("the restored database is open") });
  });

  it("refuses a restore that lost the migration table — the forgotten --schema flag", () => {
    const restored: Manifest = { ...taken, migrations: [] };
    const result = compareManifests(taken, restored);
    expect(result).toMatchObject({ reason: "manifests-differ" });
    expect(result).toMatchObject({ detail: expect.stringContaining("drizzle schema") });
  });

  it("refuses two empty manifests instead of calling them a match", () => {
    const nothing: Manifest = { tables: {}, migrations: [], policies: 0 };
    expect(compareManifests(nothing, nothing)).toMatchObject({ reason: "nothing-was-counted" });
  });

  it("refuses a source with tables but no applied migration", () => {
    const empty: Manifest = { tables: { "public.tasks": 1 }, migrations: [], policies: 0 };
    expect(compareManifests(empty, empty)).toMatchObject({ reason: "nothing-was-counted" });
  });
});

describe("the record a drill leaves behind", () => {
  it("fills what it knows and leaves the questions for the person", () => {
    const filled = renderDrillRecord("# {{date}}\n\nSource: {{source}}\nLearned: {{learned}}\n", {
      date: "2026-09-21",
      source: "supabase",
    });
    expect(filled).toBe("# 2026-09-21\n\nSource: supabase\nLearned: {{learned}}\n");
  });
});
