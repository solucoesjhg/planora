import { describe, expect, it } from "vitest";
import { isLocal, resolveTestDatabase, withDatabaseName } from "./database-url";

const dev = "postgresql://postgres:postgres@127.0.0.1:54322/planora_dev";

describe("the integration suite's database", () => {
  it("is nothing when nothing is configured, so the suite skips itself", () => {
    expect(resolveTestDatabase({})).toEqual({ kind: "none" });
    expect(resolveTestDatabase({ DATABASE_URL: "  " })).toEqual({ kind: "none" });
  });

  it("is never the one the app runs on: DATABASE_URL is renamed to planora_test", () => {
    expect(resolveTestDatabase({ DATABASE_URL: dev })).toEqual({
      kind: "ready",
      url: "postgresql://postgres:postgres@127.0.0.1:54322/planora_test",
    });
  });

  it("keeps the server, credentials and options when renaming", () => {
    expect(
      withDatabaseName("postgresql://u:p%40ss@localhost:5432/app?sslmode=disable", "app_test"),
    ).toBe("postgresql://u:p%40ss@localhost:5432/app_test?sslmode=disable");
  });

  it("takes TEST_DATABASE_URL as given when it is set", () => {
    const url = "postgresql://postgres:postgres@localhost:5432/other_test";
    expect(resolveTestDatabase({ DATABASE_URL: dev, TEST_DATABASE_URL: url })).toEqual({
      kind: "ready",
      url,
    });
  });

  it("refuses the development database even when named explicitly", () => {
    const result = resolveTestDatabase({ TEST_DATABASE_URL: dev });
    expect(result.kind).toBe("refused");
    expect(result).toMatchObject({ reason: expect.stringContaining('"planora_dev"') });
    expect(result).toMatchObject({ reason: expect.stringContaining("TEST_DATABASE_URL") });
  });

  it("refuses a database that is not on this machine", () => {
    const result = resolveTestDatabase({
      DATABASE_URL: "postgresql://postgres:secret@db.example.supabase.co:6543/postgres",
    });
    expect(result.kind).toBe("refused");
    expect(result).toMatchObject({
      reason: expect.stringContaining("db.example.supabase.co"),
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("refuses what it cannot read", () => {
    expect(resolveTestDatabase({ DATABASE_URL: "not a url" }).kind).toBe("refused");
  });
});

/**
 * The E2E server connects as `planora_app` with a password that is in git, so
 * the suite sets that password only where this says yes (ADR 0003).
 */
describe("a database on this machine", () => {
  it("is one the local suites may give the application role a password on", () => {
    expect(isLocal(dev)).toBe(true);
    expect(isLocal("postgresql://postgres:postgres@localhost:5432/planora_dev")).toBe(true);
  });

  it("is never a remote one, nor anything unreadable", () => {
    expect(
      isLocal("postgresql://postgres.abc:secret@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"),
    ).toBe(false);
    expect(isLocal("not a url")).toBe(false);
  });
});
