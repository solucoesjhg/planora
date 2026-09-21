/**
 * The database connection and the four lanes that reach it
 * (DEVELOPMENT_PLAN.md §2.4, §5, §9 · ADR 0002).
 *
 * Drizzle speaks the Postgres wire protocol through Supabase's pooler in
 * transaction mode, which is why prepared statements are off: a pooled
 * connection is not the same session twice. That same fact is what shapes the
 * lanes below. In transaction mode a statement sent outside `BEGIN` is its own
 * implicit transaction and may land on any backend, so a setting applied to one
 * statement is not there for the next — and a session-level `SET` left behind
 * on a recycled backend would be the *previous* tenant's, which is worse than
 * no barrier at all. An explicit transaction is therefore the only unit of
 * session state that exists here, and every access opens one.
 *
 * Four lanes, and nothing else may touch the pool:
 *
 *   withTenant(context, run)   a request inside a workspace — almost everything
 *   withUser(userId, run)      the DAL's bootstrap, before a workspace is known
 *   withInvitation(hash, userId, run)  the page reached by a token, and the accept
 *   getSystemDatabase()        the paths that are cross-workspace by design
 *
 * The fourth is deliberately a raw pool rather than a scope: Better Auth's own
 * tables, the outbox dispatcher, the clock's routines, email delivery and
 * digests, and the signup path that writes a person's first workspace all read
 * across workspaces by construction. An ESLint rule keeps it inside the four
 * directories that may hold it.
 */

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { TenantContext } from "@/server/auth/tenant";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything a repository can run a query on: the pool or an open transaction. */
export type Executor = Database | Transaction;

export type Connection = {
  readonly db: Database;
  readonly close: () => Promise<void>;
};

/**
 * The workspace a lane that has no workspace still has to name.
 *
 * `planora_app` starts every session with `planora.workspace_id` set to a
 * string that is not a uuid, so a statement outside any lane raises rather than
 * returning nothing (migration 0008). The bootstrap and invitation lanes do
 * have to run, though, so they set a uuid that is valid and matches no row.
 */
const NO_WORKSPACE = "00000000-0000-0000-0000-000000000000";

export function createDatabase(url: string, max = 5): Connection {
  const sqlClient = postgres(url, { prepare: false, max, onnotice: () => {} });
  return {
    db: drizzle(sqlClient, { schema }),
    close: () => sqlClient.end({ timeout: 5 }),
  };
}

let appConnection: Connection | null = null;
let systemConnection: Connection | null = null;

/**
 * The application's pool.
 *
 * `APP_DATABASE_URL` is the one that connects as `planora_app`, the role that
 * cannot bypass the policies. With it unset the pool falls back to
 * `DATABASE_URL` and the lanes still run at their full cost — every scope is
 * opened, every setting applied — with the barrier inert because the owner
 * bypasses RLS. That is the sequence the phase was landed in: the scoping
 * ships, is measured and can be rolled back, and one variable turns the
 * database's own refusal on.
 */
export function getDatabase(): Database {
  if (appConnection) return appConnection.db;
  appConnection = createDatabase(required("APP_DATABASE_URL", "DATABASE_URL"));
  return appConnection.db;
}

/**
 * The pool for the four cross-workspace paths (ADR 0002). It connects as
 * `planora_system`, which holds `BYPASSRLS` — so every caller of this function
 * is a caller that has been argued for, and the ESLint rule is what keeps the
 * list from growing by accident.
 */
export function getSystemDatabase(): Database {
  if (systemConnection) return systemConnection.db;
  systemConnection = createDatabase(required("SYSTEM_DATABASE_URL", "DATABASE_URL"));
  return systemConnection.db;
}

function required(preferred: string, fallback: string): string {
  const url = process.env[preferred] ?? process.env[fallback];
  if (!url) throw new Error(`${fallback} is not set`);
  return url;
}

/**
 * A request inside a workspace.
 *
 * Opens the transaction, applies the settings the policies read, and hands the
 * callback the transaction as the `Executor` every repository already accepts —
 * so no repository signature moves. One scope per unit of work, never one per
 * query: the dashboard loops serially over projects, and a scope around each
 * repository call would cost two hundred round trips where one costs two.
 *
 * The settings statement is not awaited before the work starts. postgres.js
 * writes queries to the reserved connection in call order and Postgres executes
 * them in arrival order, so issuing both in the same tick pipelines them into
 * one round trip instead of two. The no-op `catch` is only there so that a
 * settings failure cannot surface as an unhandled rejection before the `all`
 * below reports it.
 */
export function withTenant<T>(
  context: TenantContext,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return scope(context.workspaceId, context.userId, null, run);
}

/**
 * The DAL's own bootstrap: which workspaces this person belongs to, asked
 * before any workspace is known, and the account bar that renders the answer.
 */
export function withUser<T>(
  userId: string,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return scope(NO_WORKSPACE, userId, null, run);
}

/**
 * The invitation page, and the click that accepts.
 *
 * It is opened from a mail client, so it arrives with a token rather than a
 * workspace. The token itself is never stored; its SHA-256 is, and that is what
 * the policy compares. The user id travels with it because accepting writes the
 * first membership this person has in that workspace — which, by definition, no
 * membership can authorize. The live invitation is what does, and only for the
 * person presenting it (migration 0009).
 */
export function withInvitation<T>(
  tokenHash: string,
  userId: string | null,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return scope(NO_WORKSPACE, userId, tokenHash, run);
}

/**
 * Run inside the scope we are already in, or open one.
 *
 * The services that already opened a transaction keep their atomicity and
 * become savepoints inside the request's scope rather than a second, unscoped
 * transaction — which is the same mechanism `ensurePersonalWorkspace` has
 * relied on since Phase 3.
 */
export function inScope<T>(
  executor: Executor,
  context: TenantContext,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (isTransaction(executor)) return run(executor);
  // A pool, so open a scope — on *that* pool, not on the application's. The
  // difference matters twice: the dispatcher runs rules on the system lane and
  // would otherwise cross into the request's, and the integration suite hands
  // services a connection to its own database and would otherwise write into
  // the developer's.
  return scopedTransaction(
    executor,
    { workspaceId: context.workspaceId, userId: context.userId, tokenHash: null },
    run,
  );
}

/** A pool has `transaction`; a transaction has `rollback`. */
function isTransaction(executor: Executor): executor is Transaction {
  return "rollback" in executor;
}

function scope<T>(
  workspaceId: string,
  userId: string | null,
  tokenHash: string | null,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return scopedTransaction(getDatabase(), { workspaceId, userId, tokenHash }, run);
}

export type Scope = {
  readonly workspaceId: string;
  readonly userId: string | null;
  readonly tokenHash: string | null;
};

/**
 * The scope the three lanes above open, on a connection of the caller's
 * choosing.
 *
 * Exported for one caller only: the barrier's own test, which has to apply the
 * real settings over a connection made as `planora_app` rather than as the
 * owner the rest of the suite uses. A test that reimplemented the scope would
 * prove that its own reimplementation holds.
 */
export function scopedTransaction<T>(
  db: Database,
  { workspaceId, userId, tokenHash }: Scope,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const applied = tx.execute(sql`select
      set_config('planora.workspace_id', ${workspaceId}, true),
      set_config('planora.user_id', ${userId ?? ""}, true),
      set_config('planora.invitation_token_hash', ${tokenHash ?? ""}, true)`);
    applied.catch(() => {});

    const [, value] = await Promise.all([applied, run(tx)]);
    return value;
  });
}
