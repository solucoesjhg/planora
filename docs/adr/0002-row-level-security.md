# 0002 — Row-level security: a transaction per access, four lanes, two roles

**Date:** 2026-09-21 · **Status:** accepted · the invitation lane amended by ADR 0003

## Context

§2.4 promised RLS in Phase 10 as a second barrier, with "policies reading the
workspace from a transaction-local setting applied by the connection wrapper at
the start of every transaction". Opening the phase turned that sentence over and
found three things under it.

**A transaction is the only unit of session state we have.** The application
reaches Postgres through Supabase's pooler in transaction mode, so a statement
sent outside `BEGIN` is its own implicit transaction and may land on any
backend. A setting applied to one statement is not there for the next, and a
session-level `SET` left on a recycled backend is worse than no barrier at all:
it would be the previous tenant's. Only `set_config(..., true)` inside an
explicit transaction is both visible to the statements that follow and gone at
`COMMIT`. Reads today are plain queries — eighteen call sites — so "every
transaction" was never going to cover them.

**The wrapper does not belong where the transactions are.** Twenty-seven of the
forty-one exported service functions never open a transaction: `renameColumn`
reads and then writes on the pool, `deleteProject`, `moveProject`, every
function in `tasks/attachments.ts`, all three automation writes, `inviteMember`,
`deleteWorkspace`. A wrapper placed at the eighteen `db.transaction()` sites
would leave all of them unscoped, and they would return nothing the day the
barrier went on. The seam is the entry point — the Server Action and the Server
Component — because everything below it already takes an `Executor`.

**A policy that trusts the setting proves nothing.** The barrier exists to catch
a wrong `TenantContext` (§2.4's own last sentence). A policy of the form
`workspace_id = current_setting(...)` obeys whatever the application set, so it
catches a missing `where` clause and nothing else. Resolving the setting through
the membership table instead means a context naming a workspace the user does
not belong to buys nothing, which is the failure worth catching.

## Decision

**Every access opens a transaction, and the entry point is what opens it.**
`withTenant(context, run)` opens one, applies `planora.workspace_id` and
`planora.user_id` with `set_config(..., true)`, and hands the callback the
transaction as the `Executor` every repository already accepts. No repository
signature changes: `Executor = Database | Transaction` has been there since
Phase 2. The eighteen existing `db.transaction()` calls become savepoints
through `inScope`, which opens a transaction when handed a pool and reuses the
one it is given when already inside a scope.

**Four lanes, named and enforced.** `withTenant` for a workspace; `withUser` for
the DAL's own bootstrap, which resolves membership before a workspace is known;
`withInvitation` for the one page that is reached by a token instead of a
session; and `getSystemDatabase()` for the paths that are cross-workspace by
construction — Better Auth's own tables, the outbox dispatcher, the clock's
routines, email delivery and digests, and the signup path that writes a
person's first workspace and membership before any membership exists to check
them against. An ESLint rule keeps `getSystemDatabase` inside the four
directories that may hold it, beside the rule that already guards `domain/`.

**One new role, and the owner keeps migrating.** `planora_app` is a non-owner
without `BYPASSRLS`, with no grant at all on `users`, `sessions`, `accounts`,
`verifications` or `rate_limits`. The fourth lane runs as the owner itself,
which holds `BYPASSRLS` on Supabase and is a superuser locally. The first
draft had a second role, `planora_system`, with `BYPASSRLS` and nothing else;
the first production deploy failed on its `CREATE ROLE`, because on Postgres
15 that attribute can only be granted by a superuser and Supabase's `postgres`
is not one. A migration that works on one Postgres major and not another is
the wrong place to put a role, so the lane uses the connection that already
exists. Migrations keep running as the owner, so the policies are written by a
role the application cannot become.

**The policies resolve the setting, they do not trust it.**
`app.current_workspace()` is `STABLE SECURITY DEFINER`, with `search_path`
pinned and `EXECUTE` revoked from `PUBLIC`, and it returns the workspace only
when `workspace_members` says the user is in it. Every business table carries
`FORCE ROW LEVEL SECURITY` so the owner is subject to its own policies too.
`workspace_members` is where the design would otherwise open: its `WITH CHECK`
binds every membership write to the workspace the request is already in, so a
row naming somebody else's workspace — which would make the resolver answer for
it, and every other policy follow — is refused. Who may change a role *within* a
workspace stays the service's question (§4.4). This is a tenant barrier, not a
permission system, and pretending otherwise would put the same rule in two
places.

**A forgotten scope is loud.** With the setting absent,
`app.current_workspace()` casts the word `unset` to a uuid, so a statement that
reaches the database outside any lane raises rather than returning an empty
result. An empty board nobody reports for a week is the failure mode worth
spending a raise on. The first draft put that sentinel in the role's own
defaults with `ALTER ROLE … SET`, which for a custom parameter needs a
superuser; the owner that migrates a Supabase project is not one, and the
deploy failed there. The function needs no permission.

## Consequences

- A cross-workspace read now requires three independent failures: the
  `TenantContext`, the repository's `where`, and the database's own policy.
- Two extra round trips per scope — `BEGIN` and `COMMIT`, with `set_config`
  pipelined ahead of the first statement so it costs none. One scope per read
  unit, not one per query: the dashboard loops serially over projects, and
  per-query scoping would cost two hundred round trips where one costs two.
- Anything that awaits the network between two statements — `inviteMember`
  waiting on Resend, the attachment functions waiting on Supabase Storage —
  must do it outside the scope, or it holds a pooler backend idle in
  transaction. `idle_in_transaction_session_timeout` on the role is the
  backstop, not the design.
- The system lane is on the request path: `dispatchSoon()` runs after every
  mutating action. The barrier covers the request's own reads and writes, which
  is where a wrong context would be used, and not the dispatcher that drains
  the outbox across every workspace by design. That is a real limit and is
  written into §2.4 rather than left for the exit test to imply.
- A table added without a policy turns the suite red: the catalog test asserts
  that every table in `public` outside the named identity exemptions has
  `relrowsecurity`, `relforcerowsecurity` and at least one policy.
- The gate is the `database` job in CI, not `pnpm verify` — `verify` is
  typecheck, lint, unit tests and build, and none of them reach Postgres.

See `docs/DEVELOPMENT_PLAN.md` §2.4 and §7 Phase 10, and ADR 0001 for the
boundary this one sits beside.
