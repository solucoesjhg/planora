# Status

**Phases 0 to 9 are merged — the MVP as §6.2 defines it** — with the repairs of two reviews — the
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

**Phase 8 — dashboard, health surfaces and files.** Reading a project
evaluates it: `server/modules/health` asks the engine with the previous day's
row and the week's events, writes today's row in `project_health_snapshots`
(one per project per day, migration `0006`), and emits
`project.health_changed` when — only when — the verdict moves. The board's
right pane shows the verdict, its trend ("piorando há 5 dias", from
`trendOf` in `domain/health`), adjusted progress, the dimensions the engine
could compute — four when the project has no dates — the Top 2 and the rest of
the bottlenecks. The dashboard reads every active project the same way: one
row per project with adjusted and raw progress, verdict and heaviest reason;
the distribution of live tasks by phase; the newest `activity_logs` entries as
sentences (`lib/activity.ts`); and a right pane with the portfolio by verdict
and the projects needing attention first. Assignees are written at last:
`task_assignees`, a picker in the document, faces on the card, and the
`task.assigned` event. The files gallery groups every stored attachment by
project. Settings: theme by name, the hide-completed preference (a cookie,
like the chosen workspace), the profile's name, the export as JSON or CSV
(`/api/export`, one CSV row per task), and the Danger Zone — a project or the
workspace, deleted behind its name typed out, checked on the server too.

**Phase 9 — automations, notifications and scheduling.** The MVP ends here.
`domain/automations` decides — `when <event> · if <conditions> · then
<actions>`, at most ten actions per event, nothing past causal depth 3 — and
`server/modules/automations` performs, through the same services a click goes
through, with a context that signs as `automation` and carries the causing
event. One run per `(event, automation)` (migration `0007`), claimed before any
action: a retried dispatch re-runs nothing, a refused action is written into
the run and stops nothing else, and the log is a screen. The outbox has three
consumers now — the feed, the inbox, the rules — and gives a poisoned event up
after three attempts. Notifications: one inbox row per person per event, the
person who acted excluded; email as a delivery of that row, attempted three
times, never a second row; per-person channels with defaults, and a daily or
weekly digest. The clock's routines — due in two days, overdue, stalled past
the phase threshold, the daily health evaluation — emit at most one event per
task per day, and `GET /api/scheduler` runs a whole tick behind `CRON_SECRET`
(pg_cron every minute on Supabase, a daily Vercel Cron as the net). Screens:
`/settings/automations` with the form, the rules and the run log;
`/settings/notifications`; `/inbox` with the bell in every header.

**After the MVP — the board, the shell, the kit and the phone.** Tailwind v4
had dropped the `[--var]` syntax and two board classes were dead: columns never
had their 300px nor their gap. Fixed, and columns now fill the strip. The board
reads as paper — procedural grain, layered shadow, a colour per phase (planning
and review had shared one), the right-hand accent and rules the card spec
always asked for, the phase as a continuous fall of colour at the top of each
column. `(app)/layout.tsx` renders the shell's persistent part once, so a
navigation no longer remounts the rail; "Quadro" lights on a board and links
straight to the last one opened. Hover-to-scroll at the strip's edges where a
pointer can hover; on touch a swipe scrolls and a long press carries; "Nova
tarefa" pinned above the cards. The kit's composition brought over: 58px rail
items under a serif wordmark, a 40px title with its eyebrow, 64px serif column
headers, the progress donut, the main tasks and the mini project list in the
pane, 44px controls, the vignette. Below 768px the board is one phase at a
time with tabs, a health strip under the title and a bottom bar.
`pnpm db:seed:dev` writes a standing local account. What departs from the kit
on purpose, and where the kit contradicted itself, is in
`docs/design/10-decisoes-e-erratas.md`.

**Password recovery.** The plan put it in Phase 3 and the server half was
there — `sendResetPassword`, the template, the rate rule — but nothing on the
screen reached it. Now "Esqueci minha senha" under the login form leads to
`/forgot-password`, which answers the same whether or not the address exists;
the message carries a single-use link, good for an hour, to `/reset-password`,
which reads the token or the error from the query on the server and shows the
form, the "não vale mais" screen or the done screen. A reset revokes every
session on the old password, and the policy checks the new one against the
person's own name and address, read from the token. Four integration tests and
one end-to-end through the local inbox.

**The clock, in production (2026-09-20).** `CRON_SECRET` is set in Vercel and
the deployment answers to it: without a bearer `/api/scheduler` is now 401
rather than 404, and the first tick answered `ok` in under half a second —
three projects evaluated, one health changed, nothing due, overdue or stalled,
no mail. Vercel's daily cron carries the same header on its own. The minute
tick is scheduled on Supabase — `pg_cron` and `pg_net` enabled,
`planora-scheduler`, `* * * * *` — with the same secret. The secret was
rotated once the same day, after its first value had crossed a chat; the old
value answers 401 and the new one `ok`. `net._http_response` on Supabase shows
the ticks landing: a 200 with the route's `ok` body every minute, each
answered in about two hundred milliseconds. The statement in
`DEPLOY.md` gained `timeout_milliseconds := 30000`: pg_net gives up after five
seconds by default, and a tick with digests to send can take longer than that.
Signing out, which had worked since Phase 3 without a test, has one now in
`auth.spec.ts`.

**Phase 10 — hardening.** Row-level security as a second barrier, and
building it corrected §2.4 twice (ADR 0002). A transaction is the only unit of
session state a transaction-mode pooler has, so every access opens a scope —
reads included, which were plain queries at eighteen call sites — and the scope
is opened at the entry point, because twenty-seven of the forty-one service
functions never opened a transaction of their own and would have run unscoped.
The policies do not trust the setting they read: `app.current_workspace()`
resolves it through `workspace_members`, so a context naming a workspace the
person is not in buys nothing, which is the failure the barrier is for.
`planora_app` holds no `BYPASSRLS` and no grant on the identity tables; the
four paths that cross workspaces by construction — Better Auth, the outbox and
the clock, email and digests, and the first workspace an account gets — run as
the owner, and an ESLint rule keeps that list from growing. The first deploy
of the phase failed on a second role, `planora_system`, that carried
`BYPASSRLS`: on Postgres 15 only a superuser may create one, and Supabase's
`postgres` is not. The role is gone; the owner already bypasses.
A statement outside any lane raises rather than returning an empty result,
because an empty board nobody reports for a week is the worse failure. Fifteen
integration tests connect as the application role with no tenant check at all,
and a catalog test turns red on a table added without a policy.

**The allowance.** Sixty writes a minute per person, ten for invitations, in
the table Better Auth already owns, under keys that cannot collide with its
own. It runs on the system lane so the count survives the refused transaction,
and `select … for update` makes it a count rather than an estimate. The
decision is pure; the awkward cases — the request that exactly reaches the
limit, the one a millisecond before the window turns, a counter from a clock
that disagrees — are unit tests.

**The headers, the feed and the drill.** The security headers moved from
`vercel.json`, where only the edge could see them, into `next.config.ts`, where
`pnpm start` serves them and the E2E suite can finally assert them — with a
Content-Security-Policy beside them, no nonce and the reason written down.
All seventeen catalogued event types now reach the activity feed as pt-BR
prose through a total map; the clock's three were printing their own
identifiers on the dashboard. And `pnpm db:restore-drill` rebuilds a database
from a dump and compares row counts, migrations and policy counts before it
calls a backup real — it caught a stale hard-coded schema list on its first
run, which is the argument for it existing.

**The barrier is on in production (2026-09-22).** `planora_app` has its
password, `APP_DATABASE_URL` points at it, and the deployment connects as the
role that cannot bypass a policy — checked in `pg_stat_activity`. The policies
that shipped inert with the phase now bite; clearing that one variable rolls it
back. `SUPABASE_URL` reaches the build, so the Content-Security-Policy names
the bucket's origin and attachment images are not refused.

**The phone's long press was never broken — its test dragged off the screen
(2026-09-22).** `board.spec.ts` → "a swipe on a card scrolls, and a long press
carries it" had failed since the day it was written (#20), on `main` as much as
on any branch, which is why it looked like the touch simulation or Playwright.
It is neither. The press works: the hold raises the drag overlay on schedule,
and `TouchSensor`'s 250ms delay and the helper's 350ms agree. The carry was the
problem. On a Pixel 7 one column fills the strip, so the card's centre sits at
x=206 of a 412px screen, and the test pushed the finger 320px to the right —
to x=526, 134px past the edge of the phone. `pointerWithin` finds no droppable
out there, `over` is null, and the board correctly does nothing; dnd-kit's
auto-scroll meanwhile ran the strip to its far end. A finger cannot leave a
real screen, so nothing about it was reachable in use.

The gesture now goes where the phone actually offers one: straight up onto the
phase tab, which `PhaseTabs` already registers as a drop target for exactly
this, at the card's own x so the strip's auto-scroll margins stay out of it.
The test asserts the destination phase rather than merely "not planning", and
passed five runs for five. **62 of 62.**
**The verification link confirms, and signs nobody in (2026-09-22).** The last
open decision, closed. It used to do both, so the message in the inbox was a
live credential — and a GET that changes state is exactly what a mail scanner
or a security gateway follows before the person does. Whichever arrived first
took the session; the person's own click then hit Better Auth's
already-verified branch, which returns before creating one, and they landed on
a page the proxy bounced straight back to a login form with nothing to explain
it. So the convenience was not even reliable. Now the link lands on `/login`
saying the address is confirmed, carrying `next` when sign-up was on its way
to an invitation, and a link that failed carries its reason instead — Better
Auth appends `error=` to the callback rather than replacing it, so the same
form had to be able to say the opposite of "confirmado". The cost is one extra
step at sign-up, once per account. This is the shape the invitation flow was
given for the same reason: accepting is a click, not a page load.

**And the open redirect underneath it.** `/login?next=` and `/register?next=`
had accepted anything starting with a slash since Phase 3, which is not the
same as a path on this site: a browser reads `//evil.example` as another host.
`safeDestination()` in `src/lib/nav.ts` resolves the value and compares
origins, and then — this is the part an adversarial review caught in the first
draft — checks the string it is about to return rather than the URL it parsed.
`/..//evil.example` resolves to an internal origin, because the `..` is
consumed on the way, and serialises to `//evil.example`, which the next
consumer resolves off-site. A redirect arriving right after a real sign-in is
the one a person trusts most.

**Invitations work again, and belong to their address (2026-09-24).** The
security audit (below) found that no invitation had been accepted since the
barrier went on: the click marked the invitation accepted with an `UPDATE` the
invitation's own `WITH CHECK` refused, and the whole join rolled back. Nothing
noticed because the barrier's test wrote the membership by hand and every other
suite, the E2E server included, connected as the owner. Reproduced end to end
on `main` with the server connected as `planora_app`; green on the fix. The
same audit found that an admin could invite someone as `owner` — the form never
offered it, the Server Action accepted it — and that an invitation was a bearer
link: the address it was sent to was stored and never read, and two accounts
racing on one link both got in. ADR 0003 is the decision.
`app.accept_invitation` (migration `0010`) now joins in one statement as the
owner: a live invitation, sent to the presenting person's verified address,
claimed under a row lock, joined with the role the invitation carries. The
invitation lane only reads; no lane can write a membership into a workspace it
is not already in. `grantableRoles()` beside `can()` says nobody grants above
their own role and nobody grants ownership, and the members screen offers
exactly that list. The E2E server now connects as `planora_app` whenever its
database is on this machine — 62 of 62 pass that way — so a policy that
refuses a real flow fails a test before it fails a person. `DEPLOY.md` §7.5 has
the one query to run in production: whether an `owner` invitation was ever
issued.

## Next

- The rest of the security audit, in this order — each its own pull request:
  the automations (fan-out and `notify` reaching non-members), the identity
  tables' exposure through Supabase's Data API (run the query in the audit
  section first), attachments, the pre-registered account, the ESLint
  boundaries and `server-only`, then the barrier's per-command policies. The
  list is below, under **What the security audit found**.
- Phase 11 · Launch readiness — a preview per pull request, error tracking, the
  performance budget, the accessibility pass, and E2E in CI (§7).
- Watch the phone board in use. Directions B (a snapping carousel) and C (a
  list by phase) are kept in the design canvas of 2026-09-17 in case tabs do
  not prove out.

## Open decisions

None open. The verification link was the last one, and it was decided on
2026-09-22 — the entry is under **Done**, above.

## Blocked / open

- **The Supabase CLI stack was not adopted.** Phase 7 took the fallback §9.1
  named instead: Docker Postgres plus a filesystem storage adapter behind
  `server/storage/`. Local development runs `docker compose up -d` — Postgres
  on 54322, Mailpit on 8025 — and files land in `.storage/`. §5.1 was updated.
  A Supabase bucket needs only the credentials; no other file changes.
- **E2E does not run in CI yet.** It needs Postgres, Mailpit and a browser on
  the runner; the plan puts the full suite in CI at Phase 11. It runs locally
  with `pnpm e2e`.
- `pnpm db:seed:dev` writes one standing developer account with the example
  project, and refuses any database that is not local. A full `db:seed` of a
  populated board is still worth adding when a screen needs one to look at;
  `/dev/ui` renders hand-written examples rather than database rows.
- CI warns that the `actions/*@v4` steps target Node 20, which GitHub has
  deprecated; the runner forces Node 24 and the jobs pass.

## What the security audit found (2026-09-24)

Five reviewers in parallel — authentication, authorization across every Server
Action, the database barrier and raw SQL, files and rich content, and what
reaches the browser — each finding reproduced against a local Postgres, as
`planora_app` where the barrier was the question. Tenant isolation held
everywhere it was attacked: every id a client sends is scoped by
`workspace_id`, and the policies refused cross-workspace reads and writes on
their own. The sanitizer, `safeDestination`, CSRF, cookies, headers and the
client bundles held too; no secret is in git or in the browser. What did not:

**Repaired** (ADR 0003): accepting an invitation failed in production; an admin
could create owners; an invitation was not bound to its address, and could be
redeemed twice at once; the invitation lane could write a membership with any
role.

**Open, most serious first:**

- **Automations multiply without bound.** The ten-action cap is per rule, not
  per event, and a workspace may have any number of rules; `create_subtask`
  grows as B + B² + B³ to depth 3. One task can become a million, and the
  outbox is one queue for every workspace. Any new account can do it.
- **`notify → user` reaches anybody.** The recipient is not checked against
  membership, the dispatcher writes on the system lane, and the email goes out
  from Planora's domain. `notifications`, `task_assignees` and
  `notification_preferences` are also not tied to membership in the database.
- **The identity tables have RLS off.** `sessions`, `accounts`,
  `verifications` and `rate_limits` rely on grants alone. On Supabase, tables
  created in `public` usually carry default grants to `anon` and
  `authenticated`, which would put session tokens and password hashes behind
  the anon key through the Data API. Planora never publishes that key, so this
  is latent — check it:
  `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_name in ('sessions','accounts','verifications','rate_limits') and grantee in ('anon','authenticated');`
- **A pre-registered address can be taken.** Somebody signs up with another
  person's address and a password of their own; when the owner of the address
  later signs up, Better Auth answers "ok" and sends nothing, and "Reenviar"
  sends a link that verifies the first account — the stranger's password.
- **Attachments trust the declared type.** `confirmUpload` never compares what
  landed with what was declared, the bucket has no type or size limit, and an
  SVG is served inline from the storage origin. Unconfirmed uploads are never
  cleaned up and are still served.
- **The ESLint boundaries are not enforced.** The domain rule is overwritten by
  the lane rule (flat config replaces a rule's options), so `domain/` may
  import anything; the lane rule misses a relative import; nothing stops a
  client component importing `server/` — and `board.tsx` ships the Drizzle
  schema to the browser. `server-only` is missing from the modules holding
  secrets.
- **Barrier gaps the application does not reach today.** The `workspaces`
  policy uses one expression for every command, so any member — a viewer —
  may `DELETE` a workspace at the database level; `workspace_members` likewise
  for one's own memberships. `outbox_events.dedupe_key` is unique across
  tenants. `planora.user_id` is believed, not resolved.
- Lower: formula injection in the CSV export; a deleted project still readable
  and writable by id; any member may delete anyone's attachment; comments
  signed by an automation editable by the rule's author; the account name
  (unbounded) in email subjects; response timing on sign-up and reset;
  third-party and SQL error text reaching the client; expired invitations
  blocking an address forever, and no way to revoke one; `docker-compose`
  publishing Postgres and Mailpit on every interface with the default
  password; CI without a `permissions` block or pinned actions.

Not security, found on the way: `/api/attachments` ignores the chosen
workspace; deleting a workspace leaves its files in the bucket; a date like
`2026-99-99` passes validation and becomes a 500.

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
  The causes on the deployment, read from the runtime log, one after the
  other: `Invalid API key` — `SUPABASE_SERVICE_ROLE_KEY` did not hold a key of
  the project — and then `Invalid path specified in request URL`, which is
  PostgREST's PGRST125: `SUPABASE_URL` carried `/rest/v1`, so every storage
  request reached the Data API. The adapter now refuses a project URL with a
  path, naming the variable and the fix; the screen shows the store's words.
- **The private bucket is now checked, not assumed.** Chasing the upload,
  the bucket's *Public* switch got flipped. It is the property every signed
  URL rests on and it lives in a dashboard checkbox, so the Supabase adapter
  asks the bucket once per process before the first ticket or link and refuses
  while it is public — asking again after a refusal, so flipping it back needs
  no redeploy. Three unit tests against a stand-in for the SDK.
- **Two merges to `main` produced no deployment** (#15). The `ignoreCommand`
  from #12 read `VERCEL_ENV`, which Vercel hands to the Ignored Build Step only
  while *Automatically expose System Environment Variables* is on; with it
  absent the command exited 0 and every build was skipped, production
  included — the production that existed had come from manual redeploys, the
  one path that bypasses the switch. The command now builds when the variable
  is absent. The first merge after it deployed on its own, in about a minute.
- **Passed as they were.** The verification link pointed at the deployment; a
  task due today read "hoje"; a move, a new task and a resolved dependency each
  left rows in `activity_logs`. The limiter passed from outside without
  creating accounts: ten sign-ins with a wrong password answered 401, the
  eleventh 429 with `retry-after: 60`.
- **All five checks pass** (2026-09-15, after #15 deployed): the attachment
  opens through a `supabase.co` signed URL from its `/api/attachments/<id>`
  address. The Phase 3 criterion is closed.
- **Still to be swept:** an upload that got its ticket and never confirmed
  leaves a `pending` row (the network test above makes one). Nothing reads
  them; a sweep belongs with the file gallery in Phase 8.

## Decisions taken since the plan

- **The shell is a layout; a screen is only its centre.** `(app)/layout.tsx`
  renders `ShellFrame` — grid, rail, navigation drawer — once, and `AppShell`
  inside it draws only header, centre and panel. On its own, as in the
  gallery, `AppShell` still draws the whole shell, so no page changed. This is
  what stopped every navigation from blinking the shell out and back.
- **The last board is a cookie the browser writes.** A page cannot set a
  cookie while rendering, so the board writes `planora-last-board` on the
  client; it holds an id already in the address bar, so it is not `httpOnly`,
  and the rail reads it to keep "Quadro" pointing at the right board without a
  reload. Deleting a project clears it.
- **A mouse and a finger are different sensors.** dnd-kit's `MouseSensor`
  activates on 5px of travel; its `TouchSensor` only after a 250ms hold, and
  cards allow panning (`touch-action: manipulation`), so a swipe over a card
  scrolls the strip. Before, `touch-action: none` made most of a column
  unscrollable on a phone.
- **Design decisions live next to the kit.** `docs/design/10-decisoes-e-erratas.md`
  records each deliberate departure with its date, resolves the kit's internal
  contradictions (measure and colour come from the tokens, drawing from the
  spec) and lists what is not built yet. Without it the next reader of a spec
  "fixes" a decision back.
- **Provenance travels on the `TenantContext`.** A rule runs with the
  workspace's permissions but is not the person who wrote it: `context.actor`
  says `automation`, names the causing event and its depth, and `provenance()`
  is what every emit — and the phase trail, and a comment — signs with. Ten
  emit sites that used to write `actorKind: "user"` by hand now cannot get it
  wrong.
- **A comment knows who really wrote it.** `task_comments.actor_kind`: a
  rule's comment reads as "Planora · automação" in the document, never as the
  person who owns the rule — §4.6 applied to the one row that had a person's
  id and no way to say otherwise.
- **The dispatcher gives up after three attempts.** An event that fails three
  dispatches is marked processed with its last error rather than holding the
  queue forever; the log keeps the reason.
- **A rule with more than ten actions is refused when written, and capped when
  run.** Two guards for one rule: the form cannot save it, and a row put there
  by any other route still fires ten.
- **Nobody is told what they did themselves.** Recipients of every event
  exclude its actor; a solo workspace therefore hears only from the clock and
  from its own rules' `notify` actions.
- **A tick drains the outbox until it is quiet.** A rule's action emits events
  of its own; dispatching once per mutation left them pending until the next
  click, and the feed showed the move but not the comment the move caused.
  `drainOutbox` repeats the pass while something was processed, bounded at six
  — the engine's depth guard is what keeps a loop from reaching the bound.
- **The minute tick is pg_cron; the Vercel cron is daily.** The Hobby plan runs
  crons once a day, so the plan's "every minute" comes from Supabase's own
  scheduler calling the route — one SQL statement, documented — and Vercel's
  daily tick is the net under it.

- **Health is evaluated on read, and the previous evaluation is yesterday's
  row.** Until Phase 9's clock exists, opening a board or the dashboard is
  what writes today's snapshot; the unique index on `(project_id, date)` makes
  the second read of the day a rewrite, not a second evaluation. Hysteresis
  therefore defends the last row *before today* — reading a project twice in
  one day is not two consecutive evaluations, and cannot flip its verdict.
- **Momentum reads the outbox, not the feed.** The activity feed is written a
  moment after the event by the dispatcher; the events themselves are written
  in the mutation's transaction. A move counts as movement the instant it was
  made.
- **`task.assigned` joined the event catalogue** (§4.5). It carries the names
  as well as the ids, so the feed says who without a lookup that would answer
  differently after somebody renamed — and Phase 9's "notify the assignee"
  has something to fire on.
- **The hide-completed preference is a cookie**, like the chosen workspace: a
  convenience of this browser, never a permission, and nothing the server
  would not show anyway. A per-account preference table can absorb it when a
  second preference appears.
- **The dictionary won over the first draft of the labels.** Appendix B had
  named `momentum` "Impulso", `stale` "Estagnada" and `insufficient_data` "Sem
  dados suficientes" before any screen showed them; the screen follows.
- **The E2E global setup migrates its own database.** The suite's server
  points at `planora_dev`; the integration harness migrated whatever
  `DATABASE_URL` named (now `planora_test`, below). Phase 8 added a table, 86
  integration tests passed, and twenty E2E tests fell into the error boundary
  at once because nothing had migrated the E2E database. Now the setup does,
  before the first request.
- **A dimension's colour asks the domain which band it is in.** The bars in
  the health pane use `bandOf()` rather than thresholds of their own — the
  Phase 8 criterion is that no component calculates, and a colour threshold is
  a calculation.

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
- **A reset signs everybody out.** `revokeSessionsOnPasswordReset` is on: a
  person resetting a password is most often taking an account back, and the
  session that should end is the one they cannot see. The reset token is a
  stored row consumed on use, so unlike the verification link it is not a
  bearer credential for its whole hour — which is why that hour was kept.
- **The policy sees who is behind a reset.** The reset request carries no name
  or address, so the hook reads the user from the token's verification row
  before checking the new password; `henrique-zanella` is refused there as it
  is at sign-up. The endpoint refuses the token itself a moment later if it is
  bad, so the lookup decides nothing on its own.
- **The integration suite has a database of its own.** Every suite truncates
  every table before each test, and the harness ran against whatever
  `DATABASE_URL` named — with `.env.local` exported that was `planora_dev`,
  and one `pnpm test:db` wiped the seeded developer account and every project
  on the board (2026-09-17). It now runs against `TEST_DATABASE_URL`, or
  `DATABASE_URL` with the database renamed to `planora_test`, creates that
  database on first run, and refuses — the run fails rather than skipping
  quietly — any URL that is not on this machine or whose database name does
  not end in `_test`. The E2E suite still runs against `planora_dev` on
  purpose: it registers accounts through the screen and clears only the
  rate-limit counters.
