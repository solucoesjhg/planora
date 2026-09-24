/**
 * Which database the integration suite is allowed to run against.
 *
 * Every suite truncates every table before each test, so the answer can never
 * be the database the app runs on. With `.env.local` exported that database is
 * `planora_dev`, and one `pnpm test:db` used to wipe the seeded developer
 * account and every project on the board. The suite now has a database of its
 * own: `TEST_DATABASE_URL` when set, otherwise `DATABASE_URL` with the database
 * renamed to `planora_test` — on the same server, with the same credentials.
 *
 * Whatever the result, it has to be on this machine and its name has to end in
 * `_test`; anything else is refused rather than truncated. Pure, so the rule
 * is unit-tested without a server.
 */

export const TEST_DATABASE_NAME = "planora_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type TestDatabase =
  | { readonly kind: "ready"; readonly url: string }
  /** Nothing configured: the suite skips itself, so `pnpm test:db` stays offline. */
  | { readonly kind: "none" }
  /** Configured, but not a database the suite may truncate. */
  | { readonly kind: "refused"; readonly reason: string };

export function resolveTestDatabase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TestDatabase {
  const explicit = env["TEST_DATABASE_URL"]?.trim();
  const base = env["DATABASE_URL"]?.trim();
  if (!explicit && !base) return { kind: "none" };

  const source = explicit ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const url = explicit || withDatabaseName(base ?? "", TEST_DATABASE_NAME);
  const reason = whyRefused(url);
  return reason
    ? { kind: "refused", reason: `${source} ${reason}` }
    : { kind: "ready", url };
}

/** The same server and credentials, another database. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = parse(url);
  if (!parsed) return url;
  parsed.pathname = `/${encodeURIComponent(name)}`;
  return parsed.toString();
}

/**
 * The role the application connects as in production (ADR 0002), and the
 * throwaway password the local suites give it. The migrations create the role
 * without one, because a migration lives in git; this one lives in git too,
 * which is why nothing sets it on a database that is not on this machine.
 */
export const APP_ROLE = "planora_app";
export const LOCAL_APP_PASSWORD = "planora_app_test_only";

/** Whether a connection string names this machine. */
export function isLocal(url: string): boolean {
  const parsed = parse(url);
  return parsed !== null && LOCAL_HOSTS.has(parsed.hostname);
}

/** The same database, reached as somebody else: the barrier's own test needs it. */
export function withCredentials(url: string, user: string, password: string): string {
  const parsed = parse(url);
  if (!parsed) return url;
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

export function databaseNameOf(url: string): string {
  const parsed = parse(url);
  if (!parsed) return "";
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

/** The URL for the server's own `postgres` database, to create ours from. */
export function maintenanceUrl(url: string): string {
  return withDatabaseName(url, "postgres");
}

/** A readable name for messages: host, port and database, never the password. */
export function describeDatabase(url: string): string {
  const parsed = parse(url);
  if (!parsed) return "(not a URL)";
  return `${parsed.hostname}:${parsed.port || "5432"}/${databaseNameOf(url)}`;
}

function whyRefused(url: string): string | null {
  const parsed = parse(url);
  if (!parsed) return "is not a URL this harness can read";
  if (!isLocal(url)) {
    return `names ${parsed.hostname}, which is not this machine; the suite truncates every table before each test`;
  }
  const name = databaseNameOf(url);
  if (!name.endsWith("_test")) {
    return `names the database "${name || "(none)"}"; the suite truncates every table before each test, so it only runs against a database whose name ends in _test`;
  }
  return null;
}

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname ? parsed : null;
  } catch {
    return null;
  }
}
