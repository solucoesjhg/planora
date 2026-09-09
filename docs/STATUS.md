# Status

**Phases 0 and 1 are merged.**
**Phase 2 is on the branch `phase-2-persistence`** ([PR #2](https://github.com/solucoesjhg/planora/pull/2)), green in CI, awaiting review.

Remote: https://github.com/solucoesjhg/planora (private)

## Done

**Phase 0 — repository foundation.** Next 16.3.4 · React 19.2.8 · strict
TypeScript with `noUncheckedIndexedAccess`; the `domain/` ESLint boundary;
Vitest and Playwright; `pnpm verify` green in CI; tokens and assets copied from
the read-only legacy directory; `AGENTS.md` and ADR 0001.

**Phase 1 — pure domain.** `progress`, `health`, `kanban`, `dependencies`,
`phase-history` and the fixtures, with 61 unit tests and no database, React or
Next anywhere in the layer.

**Phase 2 — persistence and events.** Thirteen tables with `workspace_id` and
composite tenant foreign keys, the first migration, a deterministic seed with
pinned ids and a frozen clock, repositories taking `TenantContext`, `moveTask`
calling the domain inside one transaction, the transactional outbox and its
idempotent dispatcher. 11 integration tests run against a real Postgres in the
CI `database` job.

## Next

- Review and merge PR #2.
- Phase 3 — authentication and tenancy: Better Auth with the Drizzle adapter,
  the DAL (`requireSession`, `requireWorkspace`), `proxy.ts`, transactional
  email, and the first deployed environment.

## Blocked / open

- **The Supabase CLI stack is deferred to Phase 7.** What it buys over a plain
  Postgres is Storage parity, and Storage does not arrive until then. Local
  development runs `docker compose up -d` — one `postgres:17` on port 54322, the
  same port the CLI stack uses, so `DATABASE_URL` will not change when we
  switch. This is the fallback §9.1 anticipated, taken deliberately rather than
  by accident.
- No CLI seed script yet: the seed is exercised by the integration tests. A
  `db:seed` command belongs with the `/_dev` routes in Phase 4.
- CI warns that `actions/checkout@v4`, `actions/setup-node@v4` and
  `pnpm/action-setup@v4` target Node 20, which GitHub has deprecated; the runner
  forces Node 24 and the jobs pass. Bump the action versions when convenient.

## Decisions taken since the plan

- `canMoveTask` takes the board context as a named argument; §3.6 of the plan
  was updated to match.
- The domain treats a task in `done` as never blocked — the engine-side half of
  "entering done clears the block flag" (§3.4).
- Health helpers `bandOf` and `smoothVerdict` are exported so the hysteresis
  rules can be tested without constructing a board per case.
- Only `users` is defined in the identity group for now; the rest of Better
  Auth's tables arrive with its adapter in Phase 3, whose shape is its business.
- `tsconfig` targets ES2022 rather than the scaffold's ES2017: Next 16 already
  requires Chrome 111+ and Safari 16.4+, and BigInt literals need it.
- `esbuild` is approved to run its install script in `pnpm-workspace.yaml`;
  pnpm 12 fails an install with unapproved build scripts, and drizzle-kit loads
  the schema through esbuild.
