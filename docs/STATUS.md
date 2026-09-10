# Status

**Phases 0 to 6 are merged** — Phase 3 without its deployed environment, which
was deliberately left out.
**Phase 7 is on the branch `phase-7-task-document`.**

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

**Phase 6 — Kanban.** The board is a Server Component; a single
client island owns the drag. Drop Catch calls the same `canMoveTask()` the
service calls, so a refused move bounces with its reason and **never reaches the
network** — the E2E test counts the requests. Columns are created, renamed,
reordered and deleted with their phase, planning and done staying at the ends;
a move between two neighbours writes one row; the board remembers where each
project was scrolled to.

**Phase 7 — the task as a document** (this branch). A card opens over the board
through an intercepted route, at a URL that can be shared and that renders as a
full page when followed. Tiptap writes the body, the notes and the comments —
all sanitized on the server before storage. Checklists, dependencies (the domain
refuses a cycle), comments, priority, dates and the blocked flag, with the phase
trail in the margin. Attachments upload straight to the store through a URL that
expires and come back through one signed only after the workspace check;
`server/storage/` is a port with three adapters. Cards are created at the foot
of their column.

## Next

- Review and merge the Phase 7 branch.
- **The deployed environment is the one Phase 3 item still open.** A managed
  Supabase project plus a Vercel deployment, so verification and invitation
  links have a real URL, and migrations run from the pipeline. It needs
  accounts on external services, so it waits for a decision.
- Phase 8 — dashboard, health surfaces and files: the multi-project dashboard,
  the contextual sidebar with the five dimensions, daily health snapshots and
  the trend line, the global file gallery, and settings.

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

- **The Supabase CLI stack was not adopted.** Phase 7 took the fallback §9.1
  named instead: Docker Postgres plus a filesystem storage adapter behind
  `server/storage/`. Local development runs `docker compose up -d` — Postgres
  on 54322, Mailpit on 8025 — and files land in `.storage/`. §5.1 was updated.
  A Supabase bucket needs only the credentials; no other file changes.
- **E2E does not run in CI yet.** It needs Postgres, Mailpit and a browser on
  the runner; the plan puts the full suite in CI at Phase 11. It runs locally
  with `pnpm e2e`.
- No CLI seed script yet; the seed is exercised by the integration tests, and
  `/dev/ui` renders fixtures rather than database rows. A `db:seed` command is
  worth adding when a screen needs a populated database to look at.
- CI warns that the `actions/*@v4` steps target Node 20, which GitHub has
  deprecated; the runner forces Node 24 and the jobs pass.

## Decisions taken since the plan

- **An attachment has a stable address, not a signed URL.** `/api/attachments/<id>`
  checks the session and the workspace and redirects to a URL signed on the
  spot. A signed URL is right for delivering a file and wrong for referring to
  one: the first cut put a one-hour URL into the task body, so an image dropped
  into a description would have broken an hour later, permanently — and the
  download links on the page were signed at render, so a tab open for six
  minutes held dead links.
- **TSK-N is read under a lock — now actually.** `max(number) + 1` took no lock
  while the comment claimed it did; two overlapping transactions got the same
  number and the second insert died on `tasks_project_number` as a thrown error
  rather than a refusal. The project's row is locked first.
- **The integration harness opened one connection.** Every statement ran in
  order on it, so a test written to make two transactions overlap proved
  nothing — the first concurrency test for TSK-N passed against the broken
  code. `connect()` hands out separate connections, and the regression tests use
  them: with the lock removed they fail with the duplicate key.

- **`server/storage/` is a port with three adapters**, the way email has three
  senders: Supabase Storage, the filesystem, and memory for tests. The
  filesystem adapter signs its own URLs with the secret Better Auth signs with
  and serves them from `/api/files`, so a link expires in development exactly as
  it does in production. Supabase wins whenever its credentials are present; a
  production build refuses to fall back to disk unless told to with
  `STORAGE_DRIVER=local`, which is how the E2E suite runs.
- **The store's word, not the browser's.** An upload writes a `pending` row,
  the bytes go straight to the store, and `confirmUpload` asks the store what
  landed — size, type, checksum — before the row becomes `stored`. Something
  larger than the limit is deleted along with its row.
- **One secret, resolved in one place** (`server/auth/secret.ts`). Better Auth
  had a development fallback and storage had its own check; with
  `BETTER_AUTH_SECRET` empty in `.env.local` the adapter signed with one key and
  the route verified against another — every file link a 403 that read like an
  expiry.
- **Everything an editor writes is sanitized on the server**, against an
  allowlist that is the editor's own vocabulary plus the `<section
  data-phase-note>` the domain writes. The plan had not said so; §7 Phase 7 now
  does.
- **`comment.added` joined the event catalogue** (§4.5). It is what the activity
  feed shows when somebody says something on a task.
- **The E2E workers each arrive from their own address.** The rate limiter
  counts per IP, and every worker reaches localhost as `::1`, which normalizes
  to one shared bucket — so five workers spent one worker's five signups. Each
  worker now sends its own `x-forwarded-for`, which is how real clients are
  counted apart. The production limit is untouched. *Worth checking in Phase 10:
  behind a proxy chain Better Auth needs `advanced.ipAddress.trustedProxies`, or
  it falls back to a single shared bucket for everyone.*
- **Three E2E workers locally, the default in CI.** A production build plus one
  browser per worker on this laptop starved the server and tests failed on
  timing rather than on behaviour.
- **`DndContext` gets a fixed `id`.** It names its screen-reader region from an
  internal counter, which differs between the server's render and the browser's;
  React logged a hydration mismatch on the projects grid from Phase 5.

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
