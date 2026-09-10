# Status

**Phases 0 to 5 are merged** — Phase 3 without its deployed environment, which
was deliberately left out.
**Phase 6 is on the branch `phase-6-kanban`.**

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

**Phase 3 — authentication and tenancy.** Better Auth with email
and password over the Drizzle adapter, its three tables beside our `users`; a
personal workspace created by a database hook the moment an account exists; the
DAL (`requireSession`, `requireWorkspace`, `currentSession`) marked
`server-only` and memoized per render; `proxy.ts` doing nothing but redirecting;
transactional email with versioned pt-BR templates and three senders (Resend,
Mailpit, memory); workspace invitations with expiry; and plain `/register`,
`/login`, `/dashboard` and `/invitations/[token]` pages that Phase 4 will
restyle.

**Phase 4 — design system and shell.** The v1 kit ported into
`src/styles/tokens.css` and exposed as Tailwind v4 `@theme` utilities; dark by
default with a bone light theme; Cormorant Garamond and Inter; nine primitives
on Base UI plus a calendar written here; the tri-pane shell with its collapse
rules; `/dev/ui`; and the auth and dashboard screens restyled. A lint rule
refuses a raw colour inside `components/`, and 12 E2E tests check the shell at
five widths in both themes.

**Phase 5 — projects and clients.** `canCompleteProject` in the
domain; the `clients` table and `projects.client_id`; project CRUD, completion,
reopening and drag-to-reorder through services and Server Actions; the grid
split between active and completed with deadline indicators; and an example
project seeded at signup so the first screen has something on it.

**Phase 6 — Kanban** (this branch). The board is a Server Component; a single
client island owns the drag. Drop Catch calls the same `canMoveTask()` the
service calls, so a refused move bounces with its reason and **never reaches the
network** — the E2E test counts the requests. Columns are created, renamed,
reordered and deleted with their phase, planning and done staying at the ends;
a move between two neighbours writes one row; the board remembers where each
project was scrolled to.

## Next

- Review and merge the Phase 6 branch.
- **The deployed environment is the one Phase 3 item still open.** A managed
  Supabase project plus a Vercel deployment, so verification and invitation
  links have a real URL, and migrations run from the pipeline. It needs
  accounts on external services, so it waits for a decision.
- Phase 7 — the task as a document: the intercepted detail route, Tiptap,
  checklists, dependencies, comments, attachments on Supabase Storage, and the
  phase history that archives the previous phase's notes.

## Open decisions

- **Should the verification link also sign the person in?** Today it does
  (`autoSignInAfterVerification: true` in `src/server/auth/config.ts`). The link
  is a JWT signed with `BETTER_AUTH_SECRET`, valid for 15 minutes and **not
  single-use** — Better Auth verifies the signature and expiry without storing
  it. So for that window the message in the inbox is a live credential: whoever
  opens the mailbox is in the account. Turning the flag off costs one extra step
  at signup (verify, then log in) and removes the property entirely. Revisit
  before the product holds anybody else's data — Phase 10 at the latest.

## Blocked / open

- **The Supabase CLI stack is deferred to Phase 7**, when Storage arrives.
  Local development runs `docker compose up -d`: Postgres on 54322 and Mailpit
  on 8025. This is the fallback §9.1 anticipated, taken deliberately.
- **E2E does not run in CI yet.** It needs Postgres, Mailpit and a browser on
  the runner; the plan puts the full suite in CI at Phase 11. It runs locally
  with `pnpm e2e`.
- No CLI seed script yet; the seed is exercised by the integration tests, and
  `/dev/ui` renders fixtures rather than database rows. A `db:seed` command is
  worth adding when a screen needs a populated database to look at.
- CI warns that the `actions/*@v4` steps target Node 20, which GitHub has
  deprecated; the runner forces Node 24 and the jobs pass.

## Decisions taken since the plan

- **Fractional index columns are `COLLATE "C"`.** The default collation sorts
  alphabetically and case-insensitively, so `l` sorts before `V` and the base-62
  keys scramble. Migration `0004` alters the four position columns; a reorder
  test caught it, not a reading of the code.
- **Workspace slugs are claimed, not checked.** Two signups with the same name
  raced the uniqueness check. `onConflictDoNothing` claims the slug and falls
  back — and the fallback reads the **end** of the user id, because a UUID v7
  starts with a timestamp and accounts created in the same instant share it.
- **The E2E suite works around the limiter rather than weakening it.** Sign-up
  allows five a minute per address and every Playwright worker is `127.0.0.1`,
  so a parallel run trips a rule that is doing its job. Clearing the counter
  before each signup is not enough — the other workers spend it between the
  clear and the click — so `submitRegistration` clears, submits, and retries
  when the 429 message appears. The production limit is untouched.
- **The board's state is `useOptimistic` and Server Actions, not TanStack
  Query.** The board's data comes from a Server Component and the only mutation
  is the move, so a client cache would be a second source of truth to keep in
  sync. §5 and Phase 6 in the plan were updated. TanStack Query arrives when a
  screen fetches on its own.
- **The drag overlay renders `TaskCardView`, not `TaskCard`.** The overlay used
  to render the sortable card, registering the same dnd-kit id twice, and the
  board stopped answering the mouse. Splitting the presentational card from the
  sortable wrapper fixed it.
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
- The gallery lives at `/dev/ui`, not `/_dev/ui` as the plan first said: Next
  treats a folder starting with `_` as private and never routes it. The plan
  was updated to match.
- The theme toggle keeps no React state. The theme lives in the `data-theme`
  attribute the tokens read, and CSS picks which icon to show — one source of
  truth, no effect, and no mismatch with the inline script that applies the
  stored theme before first paint.
- The calendar is written here rather than installed: a month grid is a hundred
  lines, and the arithmetic is testable without a browser.
