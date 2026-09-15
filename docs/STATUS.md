# Status

**Phases 0 to 7 are merged**, with the repairs of two reviews — the
phase-by-phase one (#9) and the consistency one (#11). **Production is live at
https://planora-rosy.vercel.app** (Vercel `gru1`, Supabase São Paulo, Resend);
the Phase 3 criterion — the same flow on the deployed URL — is met.

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

**Phase 7 — the task as a document.** A card opens over the board
through an intercepted route, at a URL that can be shared and that renders as a
full page when followed. Tiptap writes the body, the notes and the comments —
all sanitized on the server before storage. Checklists, dependencies (the domain
refuses a cycle), comments, priority, dates and the blocked flag, with the phase
trail in the margin. Attachments upload straight to the store through a URL that
expires and come back through one signed only after the workspace check;
`server/storage/` is a port with three adapters. Cards are created at the foot
of their column.

## Next

- **Finish the post-deploy checks** (`docs/DEPLOY.md`, "After the first
  deploy"). Passed: the verification email, "hoje", the activity feed. Attaching
  a file did not — `Invalid API key`, see "What the first deploy showed" — and
  is to be tried again once `SUPABASE_SERVICE_ROLE_KEY` is replaced and
  `deploy-production-findings` is deployed. Still untried: the sixth sign-up in
  a minute being refused.
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
  `/dev/ui` renders hand-written examples rather than database rows. A
  `db:seed` command is worth adding when a screen needs a populated database
  to look at.
- CI warns that the `actions/*@v4` steps target Node 20, which GitHub has
  deprecated; the runner forces Node 24 and the jobs pass.

## What the phase-by-phase review found

Read against the plan, phase by phase, with the code run against the real
database. Five defects, all repaired on `review-repairs`:

- **Every deadline was one day early** outside UTC. A `date` column was read
  into a `Date` (midnight UTC), serialised, and parsed back in the reader's
  zone. Calendar days now travel as `YYYY-MM-DD` end to end, and two tests pin
  it — one on the driver's behaviour, one on what the card says.
- **Four of the seven destinations in the rail answered with the framework's
  404**, and no error boundary existed anywhere. `/users` is now built,
  `/files`, `/settings` and `/assistant` say which phase they arrive in, and
  `error.tsx`, `global-error.tsx` and `not-found.tsx` exist.
- **Invitations led nowhere.** `inviteMember` had tests and no caller, and
  accepting one dropped you into `memberships[0]` ordered by age with no way to
  switch. The members screen sends them; the account menu switches.
- **Nothing drained the outbox** — sixteen events, zero activity rows. See
  §4.5.
- **A malformed id was a 500**, not a 404: Postgres rejects a bad uuid with an
  error rather than an empty result.

Two things the review confirmed rather than repaired: every tenant-scoped query
is scoped (the exceptions are the dispatcher, which runs across workspaces by
design, and the invitation lookup by token hash), and the health engine — 435
lines, fully tested — still has no caller, by the plan's own sequencing. It
arrives in Phase 8 having never run against real data, which is worth knowing
before it does.

## What the consistency review found

Plan, STATUS, DEPLOY, AGENTS, README, schema, events, permissions, routes,
tests and configuration, each read against the others. Repaired on
`consistency-repairs`:

- **Three catalogued events nothing emitted** — `task.completed`,
  `dependency.resolved`, `member.invited`. `moveTask` now emits the first two
  in the transaction that knows; `inviteMember` the third, after delivery.
- **A newcomer lost the invitation.** `/register` ignored `next`, so somebody
  registering to accept an invitation verified, landed on their own dashboard,
  and the token stayed in the email. `next` travels through sign-up into the
  verification link. Accepting is now a click, not a page load — a mail client
  that prefetches links would otherwise have accepted on the person's behalf —
  and the click makes the workspace joined the one the browser looks at.
- **The strings module the plan relied on did not exist.** Phase labels were
  defined three times, priorities twice, roles once with a fourth vocabulary.
  `src/lib/strings.ts` is the one place now; Appendix B matches the screens.
- **Two words for one state.** "Bloqueada" on the card and toast, "travada"
  everywhere else. It is *travada*, on every screen and in the glossary.
- **§5 named libraries the code never installed** — Framer Motion, Zustand,
  React Hook Form. The rows now say what the code does instead, and when each
  library would join.
- `PHASES` and `PRIORITIES` were defined in the domain and again in the
  schema; the schema imports them.
- `task_assignees` sat unused since Phase 2 with no phase to land in; it lands
  in Phase 8.
- Moderating comments moved from *invite members* to *manage projects*, and
  the roles table gained the column.
- README was the framework's template; `supabase` was a 100 MB devDependency
  for a stack that was never adopted; `isStuck`, `IMAGE_MIME_TYPES` and
  `setStorage` had no callers; `ENABLE_DEV_ROUTES` and `DISABLE_BREACH_CHECK`
  were read and documented nowhere.

One finding was withdrawn during the review: the task actions *do* drain the
outbox — through their shared `refresh()` helper, which a count of direct
calls missed.

And one only appeared when the suite finally ran the way its configuration
says it does. `playwright.config.ts` builds for production, but every earlier
run had found a `next dev` on port 3000 and reused it. With the port free, the
production server refused to start: `senderFromEnvironment` requires a Resend
key outside development, and the suite has none — it wants Mailpit. Storage
already had the answer (`STORAGE_DRIVER=local`); mail now has the same one,
`EMAIL_DRIVER=mailpit`, asked for by name in the suite and nowhere else.

And the suite, running against production for the first time, found one
more: **"salvo" was shown before anything was saved.** The document's `run()`
started a transition and returned at once, so the editor's `await onSave()`
resolved immediately and the label appeared while the request had not left.
Close the modal and drag the card in that window — which the E2E does in a
second, and a person does in three — and the late save posts to a URL the
router has already left; the next navigation to it is dropped. `run()` now
resolves when the action has answered, the editor keeps its unsaved flag in a
ref the blur handler cannot read stale, and closing the modal blurs the editor
before the URL changes.

## What the first deploy showed

Production is https://planora-rosy.vercel.app — Vercel in `gru1`, Supabase in
São Paulo, Resend with the test sender. Henrique ran the checks in
`docs/DEPLOY.md` by hand.

- **Migrations could not reach Supabase's direct host** (#12). It answers only
  over IPv6 and Vercel's builders have none; the build failed right after
  "Using 'postgres' driver". `MIGRATION_DATABASE_URL` is the *session pooler*
  now, and `scripts/migrate.mjs` says so when it sees the direct host fail.
- **Every preview deployment answered with a 500** (#12): no variables. The
  `ignoreCommand` in `vercel.json` skips every build that is not production
  until Phase 11 gives each pull request a database of its own.
- **"Confirme seu e-mail", and no email.** The address was one Resend's test
  sender refuses — but nothing said so: Better Auth sends the sign-up message
  through `runInBackgroundOrAwait`, which logs the failure and reports
  success. The confirmation screen now shows the address it sent to and has
  **Reenviar e-mail**, which goes through `/send-verification-email` — the
  endpoint that waits and answers with the failure. `docs/DEPLOY.md` names the
  log line to look for. E2E: the second message arrives.
- **Attaching a file: "Enviando…" for good.** The store threw (a bucket or a
  key), the Server Action rejected with its message stripped, and the button's
  `sending` flag was never reset — no path in the browser code caught anything.
  Repaired on both sides. `attachments.ts` turns any store failure into a
  `storage-unavailable` refusal and logs the cause under `[attachments]`; the
  ticket is now issued *before* the pending row, so a store that cannot be
  reached leaves nothing behind. The browser side settles every promise, names
  a network failure and a refused status, and resets the button in `finally`;
  removing a file reports its refusal too. `/api/attachments/<id>` answers 503
  rather than 404 when the store is the problem. Regression: three integration
  tests with a store that throws, one E2E that drops the upload at the network.
  The cause on the deployment, read from the runtime log: `Invalid API key` —
  `SUPABASE_SERVICE_ROLE_KEY` did not hold a key of the project. The screen
  now says that itself.
- **The private bucket is now checked, not assumed.** Chasing the upload,
  the bucket's *Public* switch got flipped. It is the property every signed
  URL rests on and it lives in a dashboard checkbox, so the Supabase adapter
  asks the bucket once per process before the first ticket or link and refuses
  while it is public — asking again after a refusal, so flipping it back needs
  no redeploy. Three unit tests against a stand-in for the SDK.
- **Passed as they were.** The verification link pointed at the deployment; a
  task due today read "hoje"; a move, a new task and a resolved dependency each
  left rows in `activity_logs`.
- **Still to be swept:** an upload that got its ticket and never confirmed
  leaves a `pending` row (the network test above makes one). Nothing reads
  them; a sweep belongs with the file gallery in Phase 8.

## Decisions taken since the plan

- **A calendar day is not an instant.** `CalendarDate` is a `YYYY-MM-DD`
  string, from the column to the screen; nothing converts one to a `Date`.
- **The chosen workspace is a cookie, and the cookie is a preference.**
  Membership is resolved from the database on every request, and a cookie
  naming a workspace the person is not in is ignored rather than obeyed —
  being removed from a workspace cannot lock somebody out of their own.
- **The outbox drains after each mutation** through `after()`, not only when
  Phase 9's clock arrives.
- **A column rebalances its keys inside the move that grew them.** The comment
  on `needsRebalance` had claimed this for four phases while nothing did it.

- **`<html suppressHydrationWarning>`.** The pre-paint script writes
  `data-theme` before React hydrates — the point of it — and React reported the
  attribute as one the server never rendered. A root-level mismatch makes React
  throw the server's HTML away and render the page again in the browser. It
  survived four phases because every test started with an empty `localStorage`,
  where the script does nothing; the regression test now starts with a theme
  already chosen, which is what anybody who has used the app once has.

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
  counted apart, and the global setup clears the counters a previous run left.
  The production limit is untouched. *Worth checking in Phase 10: behind a
  proxy chain Better Auth needs `advanced.ipAddress.trustedProxies`, or it
  falls back to a single shared bucket for everyone.*
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
