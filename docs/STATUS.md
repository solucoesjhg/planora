# Status

**Phases 0, 1 and 2 are merged.**
**Phase 3 is on the branch `phase-3-auth`** — everything except the deployed
environment, which was deliberately left out (see below).

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
composite tenant foreign keys, the first migration, a deterministic seed,
repositories taking `TenantContext`, `moveTask` calling the domain inside one
transaction, the transactional outbox and its idempotent dispatcher.

**Phase 3 — authentication and tenancy** (this branch). Better Auth with email
and password over the Drizzle adapter, its three tables beside our `users`; a
personal workspace created by a database hook the moment an account exists; the
DAL (`requireSession`, `requireWorkspace`, `currentSession`) marked
`server-only` and memoized per render; `proxy.ts` doing nothing but redirecting;
transactional email with versioned pt-BR templates and three senders (Resend,
Mailpit, memory); workspace invitations with expiry; and plain `/register`,
`/login`, `/dashboard` and `/invitations/[token]` pages that Phase 4 will
restyle.

## Next

- Review and merge the Phase 3 branch.
- **The deployed environment is the one Phase 3 item still open.** A managed
  Supabase project plus a Vercel deployment, so verification and invitation
  links have a real URL, and migrations run from the pipeline. It needs
  accounts on external services, so it waits for a decision.
- Phase 4 — design system and shell: tokens as Tailwind `@theme`, the
  primitives, the tri-pane shell and its collapse rules, `/_dev/ui`.

## Blocked / open

- **The Supabase CLI stack is deferred to Phase 7**, when Storage arrives.
  Local development runs `docker compose up -d`: Postgres on 54322 and Mailpit
  on 8025. This is the fallback §9.1 anticipated, taken deliberately.
- **E2E does not run in CI yet.** It needs Postgres, Mailpit and a browser on
  the runner; the plan puts the full suite in CI at Phase 11. It runs locally
  with `pnpm e2e`.
- No CLI seed script yet; the seed is exercised by the integration tests. A
  `db:seed` command belongs with the `/_dev` routes in Phase 4.
- CI warns that the `actions/*@v4` steps target Node 20, which GitHub has
  deprecated; the runner forces Node 24 and the jobs pass.

## Decisions taken since the plan

- `canMoveTask` takes the board context as a named argument; §3.6 was updated.
- The domain treats a task in `done` as never blocked (§3.4).
- `bandOf` and `smoothVerdict` are exported so hysteresis can be tested directly.
- Only `users` was defined in Phase 2; `sessions`, `accounts` and
  `verifications` arrived with the adapter in Phase 3, matching its field names.
- `tsconfig` targets ES2022 rather than the scaffold's ES2017.
- `esbuild` is approved to run its install script in `pnpm-workspace.yaml`.
- The DAL reads `headers()` before touching the database, so a prerender bails
  out to dynamic instead of failing on a missing `DATABASE_URL`.
- `/login` takes `next` from the server page's `searchParams` rather than
  calling `useSearchParams`, which would need a Suspense boundary to build.
- Better Auth reuses an unverified account on a repeated signup rather than
  erroring; the test asserts what matters — no second account, no second
  workspace.
