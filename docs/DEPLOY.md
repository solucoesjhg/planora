# Deploying Planora

The first deployed environment (DEVELOPMENT_PLAN.md §7 Phase 3). It exists
because verification and invitation links need a real URL, and because a
managed Postgres behaves differently from one in Docker.

**It is private until Phase 11.** Phase 10 landed the hardening — row-level
security (7), the rate limit on write actions, the security headers and the
restore drill (6) — but the barrier only bites once the application connects as
`planora_app`, which is step 7. Until that is done and checked, this is your own
account and nobody else's data.

Three accounts, in this order. Supabase must exist before Vercel, because
Vercel needs its connection strings to build. Nothing below should ever be
pasted into a chat or committed: every value belongs in Vercel's environment
variables.

---

## 1. Supabase — the database and the bucket

### 1.1 Create the project

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) with
   GitHub.
2. **New project**. Organisation: your own.
3. Name: `planora`.
4. **Database Password**: use *Generate a password* and save it in a password
   manager now. It appears once, it is part of both connection strings, and
   resetting it later means changing them in Vercel.
5. **Region**: `South America (São Paulo)` — `sa-east-1`. This must match the
   Vercel region in `vercel.json`; see [Region](#region).
6. Create, and wait a minute or two while it provisions.

### 1.2 The bucket

1. Left sidebar → **Storage** → **New bucket**.
2. Name it exactly `attachments`.
3. Leave **Public bucket** *off*. It has to stay private: every file is read
   through a URL this application signs, and only after it has checked that the
   person is in the workspace the file belongs to.
4. Turn on **Restrict file upload size for bucket** and set it to **25 MB**.
5. Turn on **Restrict MIME types** and allow exactly these (the list in
   `src/domain/attachments.ts`):

   ```
   image/png, image/jpeg, image/webp, image/gif, image/avif, application/pdf,
   text/plain, text/csv, application/zip, application/msword,
   application/vnd.openxmlformats-officedocument.wordprocessingml.document,
   application/vnd.ms-excel,
   application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
   ```
6. Create — or, for a bucket that already exists, **⋯ → Edit bucket** and set
   steps 4 and 5 there.

The application checks this itself. With a public bucket every upload and
every file link is refused — the toast says the store did not answer, and the
runtime log says `bucket "attachments" is public; it must be private`. Making a
bucket public does not make an upload work: the browser uploads with a token
the server signed, and the server uses the service role key, which needs no
policy. Turning it off again takes effect on the next request, no redeploy.

It checks steps 4 and 5 too (ADR 0006), before every new upload. The browser
sends its bytes straight to the bucket, so the bucket is what refuses an SVG
sent on a ticket for a PNG, or a file larger than the application would keep.
While the bucket accepts more than that, no upload ticket is issued — the toast
says the store did not answer, and the log names the settings to change,
`bucket "attachments" accepts more than the application keeps (…)`. Files
already stored stay readable meanwhile. A stricter bucket is fine; a looser one
is not.

### 1.3 The keys

Left sidebar → **Settings** (bottom) → **API Keys**.

- **Project URL** — under *Settings → API*, looks like
  `https://abcdefgh.supabase.co`. That is `SUPABASE_URL` — **and only that**.
  The same pages show `https://abcdefgh.supabase.co/rest/v1` (the Data API)
  and `…/storage/v1`; neither goes in the variable. The SDK appends
  `/storage/v1` itself, and with `/rest/v1` in front every storage request
  reaches the Data API, which answers `Invalid path specified in request URL`.
  The application refuses such a URL by name.
- **The secret key** — Supabase is midway through renaming these. You may see:
  - a **Secret key** starting `sb_secret_…` (the current system), or
  - a legacy **`service_role`** key, a long JWT starting `eyJ…`.

  Either works. Copy one; it is `SUPABASE_SERVICE_ROLE_KEY`.

  Whichever you copy, it bypasses every access rule in the project. It belongs
  in Vercel's environment variables and nowhere else — never in the browser,
  never in the repository, never in a chat. The key labelled *publishable* or
  *anon* is the other one; this application does not use it.

### 1.4 The two connection strings

Click **Connect** at the top of the dashboard. You want two of the strings it
offers, and they are not interchangeable:

| Which | Looks like | What it is for |
|---|---|---|
| **Transaction pooler** | `…pooler.supabase.com:6543` | `DATABASE_URL` — what the application uses. Serverless opens many short-lived connections, and the pooler is what survives that |
| **Session pooler** | `…pooler.supabase.com:5432` | `MIGRATION_DATABASE_URL` — migrations only. Session mode keeps one backend for the whole connection, which is what drizzle-kit's advisory lock needs |

**Not the *Direct connection*** (`db.<ref>.supabase.co:5432`). It is the right
kind of connection for migrations, but on the free plan that host answers
**only over IPv6**, and Vercel's build environment has no IPv6 route: the build
fails right after "Using 'postgres' driver", before any migration runs, with a
connection error rather than a database one. The session pooler is the same
thing reachable over IPv4.

Both contain `[YOUR-PASSWORD]` as a placeholder: replace it with the password
from step 1.4. If the password has characters like `@`, `#` or `/`, URL-encode
them, or generate a new password without them.

Migrations need a *session*: drizzle-kit takes an advisory lock and keeps it
for the run, and a transaction pooler hands each statement to whichever backend
is free and holds neither. The build refuses the transaction pooler here
(port 6543) rather than failing halfway through a migration.

---

## 2. Resend — the email

Account verification does not work without it, and the application refuses to
start in production rather than post mail to a local inbox that is not there.

1. Sign up at [resend.com](https://resend.com).
2. **API Keys** → **Create API Key**. Permission *Sending access* is enough.
   Copy it once — that is `RESEND_API_KEY`.
3. For now, set `EMAIL_FROM` to `Planora <onboarding@resend.dev>`.

### The test sender only writes to you

While you use `onboarding@resend.dev`, Resend **refuses** any recipient except
the address that owns your Resend account, with:

> You can only send testing emails to your own email address

So: your own signup works. Inviting anybody else is refused — the application
now shows that refusal and cancels the invitation instead of leaving one
pending that can neither arrive nor be sent again.

To invite other people, verify a domain: **Domains** → **Add Domain**, add the
DNS records it gives you at your registrar, wait for it to go green, then change
`EMAIL_FROM` to something at that domain and redeploy.

---

### "Confirme seu e-mail", and nothing arrives

Sign-up hands the message to Resend **in the background and swallows the
failure**: the account exists, the screen promises an email, and the only
trace is one line in the runtime log (Vercel → *Logs*, filter by
`background task`):

```
Failed to run background task: Error: resend refused the message: 403 {...}
```

The body after the status says why — with the test sender, the recipient is
by far the most common cause. The confirmation screen shows the address it
sent to and has a **Reenviar e-mail** button; that one goes through the
endpoint that *waits* for the send, so a second try shows the failure on the
screen instead of in the log.

## 3. Vercel — the deployment

### 3.1 Import

1. Sign in at [vercel.com](https://vercel.com) with the same GitHub account.
2. **Add New → Project**, and import `solucoesjhg/planora`. If the repository
   is not listed, use *Adjust GitHub App Permissions* and grant access to it.
3. Framework preset: **Next.js**, detected. Leave the build and install
   commands alone — the build command comes from `vercel-build` in
   `package.json`, which migrates before it builds.
4. **Do not deploy yet.** Open *Environment Variables* first.

### 3.2 The variables

Add each of these for **Production** (the section below has the full table):

```
DATABASE_URL               the pooler string,  port 6543
MIGRATION_DATABASE_URL     the session pooler string, port 5432
BETTER_AUTH_SECRET         32+ random characters
BETTER_AUTH_URL            https://planora.vercel.app   (fixed in 3.4)
SUPABASE_URL               https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY  the secret key from 1.3
SUPABASE_STORAGE_BUCKET    attachments
RESEND_API_KEY             the key from step 2
EMAIL_FROM                 Planora <onboarding@resend.dev>
```

For `BETTER_AUTH_SECRET`, generate one and keep it — changing it later signs
every existing session out and invalidates every unopened verification link:

```bash
openssl rand -base64 32
```

### 3.3 Deploy

Deploy. The build log should show `[migrate] applying migrations to the
production database…` before Next starts building. If it says
`MIGRATION_DATABASE_URL points at the pooler`, you pasted the 6543 string into
the wrong variable.

### 3.4 Fix the URL and redeploy

Vercel now shows the real URL — something like `planora-xxxx.vercel.app`.

1. **Settings → Environment Variables**, edit `BETTER_AUTH_URL` to exactly that
   URL, with `https://` and no trailing slash.
2. **Deployments → ⋯ → Redeploy**.

This matters because every emailed link is built from `BETTER_AUTH_URL`. Get it
wrong and the verification email arrives pointing at `localhost`.

---

## 5. The clock

Phase 9's routines — deadlines approaching and passed, cards stalled in a
column, the daily health evaluation, email digests — run when something calls
`GET /api/scheduler` with the shared secret. Nothing inside Postgres or the
application ticks on its own.

### 5.1 The secret

Generate 32 random characters and add them as `CRON_SECRET` in Vercel →
Settings → Environment Variables (Production). Redeploy. Without it the route
answers 404; with a wrong bearer, 401.

Vercel sends that same header on its own crons, and `vercel.json` schedules one
**daily** tick at 09:00 UTC as a safety net — the Hobby plan runs crons once a
day at most, which is enough for digests and the daily snapshot, and not enough
for "deadline in two days" to be noticed the morning it becomes true.

### 5.2 The minute tick — pg_cron on Supabase

Every plan has `pg_cron` and `pg_net`. In Supabase → **Database → Extensions**,
enable both. Then in the **SQL Editor**, with your URL and secret:

```sql
select cron.schedule(
  'planora-scheduler',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://planora-rosy.vercel.app/api/scheduler',
      headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb,
      timeout_milliseconds := 30000
    )
  $$
);
```

`pg_net` gives up on a request after five seconds unless told otherwise. A
tick with digests to send can take longer than that, and a response that
never arrives is logged as a failure in `net._http_response` even when the
route finished its work — thirty seconds keeps the log honest.

`select * from cron.job;` lists it; `select cron.unschedule('planora-scheduler');`
stops it. The secret sits in the job's command in clear, readable by anyone
with the database, so keep it out of chats and screenshots. To rotate it:
change the variable in Vercel, redeploy, then unschedule and schedule again
with the new value — the ticks in between answer 401 and nothing is lost. Each tick is idempotent — the routines emit at most one event per
task per day, the outbox is keyed, and a digest is sent once per period — so a
tick that overlaps the previous one does no harm.

### 5.3 Check it

```
curl -H "Authorization: Bearer <CRON_SECRET>" https://planora-rosy.vercel.app/api/scheduler
```

answers `{"ok":true, "routines": {...}, "dispatched": {...}, ...}`. Then
*Settings → Automações* in the app shows the runs, and *Caixa de entrada* the
notifications.

## 6. The restore drill

A backup nobody has restored is a rumour. This is the drill that turns it into
a fact: take a dump, build a database from nothing but that dump, count both
sides, and say out loud what did **not** come back.

Run it after the first deploy, and again whenever a migration changes the shape
of the database. It leaves a dated file in `docs/restore-drills/`.

Check what Supabase is keeping for you as well — *Database → Backups* in the
dashboard — but treat it as a second copy, not the first: the copy you have
restored yourself is the only one whose shape you know.

### 6.1 What it does

```
pg_dump  source  →  backups/<database>-<when>.dump
                 →  planora_restore_drill, dropped and built again from that file
                 →  count both, compare, report
```

The comparison is not a glance at the output. It matches, table by table:

- every table in every schema the application owns, with its row count;
- the applied migrations in `drizzle.__drizzle_migrations` — a dump that leaves
  the `drizzle` schema out restores a database that looks complete and believes
  no migration has ever run;
- the row-level security policies (Phase 10) — a restore that brought every row
  back and no policy is a readable database with its barrier missing.

Two empty manifests match, so the drill refuses emptiness before it compares:
no tables, or no applied migrations, is a failure rather than a pass.

Which schemas the dump covers is read from the source each run rather than
written down — that list is exactly what goes stale. The first version of this
drill had `public` and `drizzle` written into it, and the migration that added
the `app` schema for the RLS policies broke the restore the same week.

`pg_dump` and `pg_restore` are not installed on this machine. They live in the
Postgres image, so every dump and restore runs through Docker — nothing to
install, and the client version becomes something you choose (6.3).

### 6.2 The rehearsal, which needs no credential

This runs entirely on this laptop, against Docker, and part of it is in the
integration suite:

```bash
pnpm test:db           # dumps the suite's database, restores it, compares
pnpm db:restore-drill  # the same, against planora_dev, with a report
```

`src/server/db/restore-drill.integration.test.ts` is what catches a wrong
`pg_dump` flag **before** production is ever dumped. `pnpm test` covers the
refusals with no database at all: the drill only ever creates and drops
`planora_restore_drill`, and refuses `planora_dev`, any `_test` database the
integration suite owns, and anything that is not on this machine.

### 6.3 Against production

Only this step needs your own Supabase credentials. Nothing here is committed,
and nothing here should be pasted into a chat.

1. **Find the connection string.** Supabase → **Connect** → the **session
   pooler** string, port 5432 — the same one `MIGRATION_DATABASE_URL` uses
   (1.4). Replace `[YOUR-PASSWORD]` with the database password.
2. **Check the server's major version.** Supabase → *Settings → Infrastructure*,
   or `select version();` in the SQL Editor. `pg_dump` must be **at least as
   new** as the server it reads. The local container is `postgres:17.11`, so if
   Supabase is on 18 the dump cannot run from it: set `DRILL_POSTGRES_IMAGE` and
   the drill runs `pg_dump` in a throwaway container of that image instead. The
   restore then runs from the same image, because `pg_restore` cannot read an
   archive written by a newer one. Without it the dump stops before writing a
   byte, with `server version: 18.x; pg_dump version: 17.x`.
3. **Run it**, in PowerShell:

```powershell
$env:DRILL_SOURCE_DATABASE_URL  = "postgresql://postgres.<ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
$env:DRILL_SCRATCH_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/planora_restore_drill"
# only when Supabase is on a newer major than the local container:
$env:DRILL_POSTGRES_IMAGE       = "postgres:18"

pnpm db:restore-drill --record
```

The second variable is not optional here: with `DATABASE_URL` naming Supabase,
a scratch database derived from it would name Supabase too, and the drill
refuses to create and drop a database anywhere but this machine.

Close the shell when the drill is done, so the string does not sit in its
history.

### 6.4 What proves it worked

```
[drill] The backup is real. …pooler.supabase.com:5432/postgres → planora_restore_drill
[drill] 26 tables, 1482 rows, 8 migrations and 21 policies came back identical, in 12.4s.
```

That is the automatic half. The other half is in the record template
(`docs/restore-drills/TEMPLATE.md`) and is worth the five minutes: open
`planora_restore_drill` and read a person, a board, one task's phase history and
an attachment row. Row counts prove the data arrived; these prove it is still
the application's data.

`--record` writes `docs/restore-drills/<date>-<database>.md` with everything the
run knows already filled in. Answer the rest by hand and commit it — a drill
nobody can point at did not happen.

The dump itself stays in `backups/`, which is git-ignored along with every
`*.dump`. It is a copy of every account, every board and every address in the
application, it is not encrypted, and it is the most sensitive file this machine
will hold. Delete it when the drill is over.

### 6.5 What a restore does **not** bring back

None of these is in a database dump. Each one belongs in the recovery plan
rather than being discovered halfway through a recovery:

- **The Storage bucket's bytes.** The `attachments` rows come back; the files
  they point at are still only in the original Supabase bucket. Nothing in this
  repository copies that bucket, so a recovery into a new project restores rows
  whose files 404 until the bucket is copied or the loss is accepted.
- **The `pg_cron` job** that ticks the scheduler (5.2). It lives in the `cron`
  schema, which belongs to the platform and is not dumped. A restored database
  has no clock until the job is scheduled again.
- **Every Vercel environment variable.** `BETTER_AUTH_SECRET` above all: a new
  one signs everybody out and invalidates every unopened verification and reset
  link. Then `CRON_SECRET`, the two connection strings, the Supabase keys and
  `RESEND_API_KEY`. They live in a password manager; nothing here can recover
  them.
- **The roles, and their grants.** `CREATE ROLE` is a cluster-wide object that no
  database dump contains, and the drill dumps with `--no-privileges` because the
  roles named in those grants do not exist on this machine. The policies and
  `FORCE ROW LEVEL SECURITY` **are** restored — the barrier comes back, the
  role it applies to does not. A recovery re-runs migration `0008` — or its
  statements by hand — so `planora_app` and its grants exist before the
  application connects.
- **Supabase's own `auth` and `storage` schemas**, which the platform rebuilds
  with a new project. This application keeps its accounts in its own `users`
  table, so that is no loss — it is why the dump covers only the schemas the
  application owns.

### 6.6 The recovery this rehearses

If the production database is lost or corrupted, in this order:

1. Create a new Supabase project in `sa-east-1` (1.1), with a **new** database
   password, and the private `attachments` bucket (1.2).
2. Restore the most recent dump into it from a container of the right version:
   `pg_restore --no-owner --no-privileges --single-transaction` against the new
   project's session pooler string. That is step 6.3 with the scratch database
   swapped for the new project.
3. Create the application's roles and their grants, then run
   `pnpm exec drizzle-kit migrate` against the new project: with the migration
   table restored, it applies only what the dump predates.
4. Put the new project's connection strings and keys into Vercel (3.2) and
   redeploy. `BETTER_AUTH_SECRET` stays exactly as it was.
5. Schedule `pg_cron` again (5.2), with the existing `CRON_SECRET`.
6. Walk the list in *After the first deploy* below. It is the same list.

Everything written between the dump and the loss is gone. That interval is the
drill's real output: it is how you decide how often to run it.

## 7. The barrier — turning row-level security on

Phase 10 put a second barrier under the tenant check: policies on every
business table, resolved through a membership lookup rather than through the
setting the application supplies (ADR 0002). Migration `0008_rls_roles.sql`
creates the role it needs; `0009_rls_policies.sql` writes the policies.
Both ship with the deployment, and **the barrier does nothing until the
application connects as one of those roles**. That is deliberate: the scoping
lands first, at its full cost, and one variable turns the database's own
refusal on — or off again.

### 7.1 Give the role a password

The migration creates `planora_app` with no login and no password, because a
migration lives in git. In the Supabase **SQL Editor**, with a secret you
generate yourself:

```sql
alter role planora_app with login password '<app password>';
```

`planora_app` has no `BYPASSRLS` and no grant at all on `sessions`, `accounts`,
`verifications` or `rate_limits`. It owns nothing, so migrations keep running
as `postgres`.

There is no second role. The four paths that are cross-workspace by
construction — Better Auth, the outbox and the clock, email and digests, the
first workspace an account gets — run as `postgres` itself, which holds
`BYPASSRLS` on Supabase. A role *with* `BYPASSRLS` can only be created by a
superuser on Postgres 15, and Supabase's `postgres` is not one.

### 7.2 Point the application at it

One more variable in Vercel → Settings → Environment Variables (Production):
the same pooler string as `DATABASE_URL` with the user and password swapped.

| Name | Role |
|---|---|
| `APP_DATABASE_URL` | `planora_app` — every request |

Redeploy. Supabase's pooler expects the user as `<role>.<project-ref>`, so the
string looks like `postgresql://planora_app.abcdefgh:<password>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`.

`DATABASE_URL` and `MIGRATION_DATABASE_URL` do not change: the system lane
reads `SYSTEM_DATABASE_URL` and falls back to `DATABASE_URL`, which is already
the owner. Set `SYSTEM_DATABASE_URL` only if you have a superuser and want a
narrower `BYPASSRLS` role of your own.

### 7.3 Check it

Sign in and open a board. Then, in the SQL Editor, confirm the deployment is
really connecting as the restricted role:

```sql
select usename, count(*) from pg_stat_activity where datname = current_database() group by 1;
```

`planora_app` should be there. If every connection is still `postgres`, the
variables did not reach the build — they are read at runtime, but the pool is
built on first use, so a redeploy is what picks them up.

The barrier's own proof is a test, not a query: `pnpm test:db` runs
`src/server/db/rls.integration.test.ts`, which connects as `planora_app` with
the tenant check absent and shows the database refusing on its own. It runs in
the `database` job of CI on every pull request — `pnpm verify` never reaches
Postgres.

### 7.4 Rolling it back

Clear `APP_DATABASE_URL` and redeploy. Every request still opens its scope
and applies its settings; the owner simply bypasses the policies. Nothing else
changes, and no migration is reversed.

### 7.5 Invitations, and one question to ask production once

From 2026-09-22, when the barrier went on, until migration
`0010_invitation_acceptance.sql` shipped, no invitation could be accepted:
the click failed on the invitation's own policy (ADR 0003). The migration moves
joining into `app.accept_invitation`, which also binds an invitation to the
address it was sent to and refuses one that grants ownership. Nothing needs
doing for it to work — it ships with the deployment like any migration.

The audit that found it also found that an admin could have issued an invitation
with the role `owner` by calling the Server Action directly. Such an invitation
can no longer be redeemed, and the migration deliberately does not delete it, so
that whether one was ever issued can still be asked. In the SQL Editor:

```sql
select i.id, w.name as workspace, i.email, u.email as invited_by, i.created_at, i.accepted_at
from workspace_invitations i
join workspaces w on w.id = i.workspace_id
join users u on u.id = i.invited_by
where i.role = 'owner';
```

No rows is the expected answer. A row with `accepted_at` set means somebody
joined a workspace as a second owner before the barrier was on; look at
`workspace_members` for that workspace before deciding what to do. Rows without
it are inert and can be deleted.

### 7.6 Supabase's Data API stays off `public`

Supabase serves `public` over HTTP — `/rest/v1` and GraphQL at `/graphql/v1` —
as its `anon` and `authenticated` roles, and by default grants them everything
on every table created there. Planora never uses it: the application reaches
Postgres only through its own connection strings. Migration
`0012_identity_tables_closed.sql` revokes every grant those two roles hold in
`public`, now and for tables created later, and turns row-level security on for
the four identity tables with no policy, so that only their owner reads them
(ADR 0005).

Keep the other half in the dashboard: **Project Settings → Data API → Exposed
schemas** without `public`. To check both, in the SQL Editor:

```sql
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('sessions', 'accounts', 'verifications', 'rate_limits');
```

No rows from the first; `true` four times from the second. (Without the
`relnamespace` line it also finds `auth.sessions`, Supabase's own login table,
which Planora does not use.)

### What a restore does not bring back

Worth repeating here because it belongs to both sections: `CREATE ROLE` is
cluster-wide and travels in no database dump, and the grants are dropped by the
`--no-privileges` the drill needs. A database restored from a backup has the
policies and `FORCE ROW LEVEL SECURITY` and **not** the roles they apply to, so
a recovery repeats 7.1 and 7.2 before the application is pointed at it. See 6.5.

## Environment variables

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **pooler**, port 6543 | the application's connection |
| `MIGRATION_DATABASE_URL` | Supabase **session pooler**, port 5432 | drizzle-kit keeps a session and takes a lock; session mode gives it one backend for the run. The build refuses the transaction pooler (6543); the direct host is IPv6-only and unreachable from Vercel |
| `BETTER_AUTH_SECRET` | 32+ random characters | signs sessions, verification links and file URLs |
| `BETTER_AUTH_URL` | the deployment's URL | every emailed link is built from it |
| `SUPABASE_URL` | project URL | Storage, and the Content-Security-Policy. Read at **build** time as well as at runtime: `next.config.ts` names the bucket's origin in `img-src` and `connect-src`, so a variable that exists only at runtime leaves it out and every attachment image is refused by the browser — in production and nowhere else |
| `SUPABASE_SERVICE_ROLE_KEY` | secret / `service_role` key | server-side only |
| `SUPABASE_STORAGE_BUCKET` | `attachments` | |
| `CRON_SECRET` | 32+ random characters | the scheduler route exists only with it (5) |
| `APP_DATABASE_URL` | the pooler, as `planora_app` | turns the barrier on (7). Absent: the request still scopes, the owner bypasses the policies |
| `SYSTEM_DATABASE_URL` | optional | the four cross-workspace paths (7); falls back to `DATABASE_URL`, which is the owner and already bypasses |
| `RESEND_API_KEY` | Resend key | required in production |
| `EMAIL_FROM` | must match a sender Resend allows | |

Deliberately **not** set: `STORAGE_DRIVER` and `EMAIL_DRIVER`. With Supabase configured the bucket
wins; without it, a production build refuses to write files to a disk that will
not be there next request.

---

## What the pipeline does

`vercel-build` runs `scripts/migrate.mjs` and then `next build`:

- a **preview** deployment skips migrations. It shares whatever database it
  points at, and a branch's half-finished migration is not something to apply
  on the way past;
- a **production** deployment migrates first, so the schema is in place before
  the code that depends on it is serving;
- migrations use the session pooler, and the script refuses to run if it is
  handed the transaction pooler.

Migrations are never applied by hand from a laptop (§7 Phase 3).

**Only `main` is built.** `vercel.json` carries an `ignoreCommand` that skips
every deployment whose `VERCEL_ENV` is not `production`. Until Phase 11 gives
each pull request a database of its own, a preview would either point at the
production database or have none — the first is dangerous, the second answers
every page with `DATABASE_URL is not set`. The same switch exists in the
dashboard under *Settings → Build and Deployment → Ignored Build Step*, but the
repository is where it belongs.

The command reads `VERCEL_ENV`, which Vercel hands to the ignore step only
while *Settings → Environment Variables → Automatically expose System
Environment Variables* is on (it is, by default). The command is written to
fail safe: with the variable absent it **builds** — the state before the
switch existed — rather than skipping every deployment, production included.
If a merge to `main` produces no deployment at all, look under *Deployments*
for one marked *Canceled* with "Ignored Build Step" as the reason, and check
that setting.

---

## After the first deploy

Check these in order — each one has already been the cause of a failure here:

1. **Sign up with a real address.** The email must arrive from Resend, and its
   link must point at the deployment rather than `localhost`. If it points at
   localhost, `BETTER_AUTH_URL` is wrong or was set after the build.
2. **Open a task and attach a file.** The link should be
   `/api/attachments/<id>` and redirect to a `supabase.co` signed URL.
   - A toast ending *o log do servidor diz o motivo* means the store threw on
     the server, before the browser sent a byte. The runtime log has the cause
     on a line starting `[attachments] the store failed to`: `Bucket not found`
     is a bucket whose name does not match `SUPABASE_STORAGE_BUCKET` (1.2);
     `Invalid path specified in request URL` is `SUPABASE_URL` with `/rest/v1`
     (or another path) after the host — see 1.3; `Invalid API key` is
     `SUPABASE_SERVICE_ROLE_KEY` holding something that is not a key of this
     project at all — cut short when pasted, copied from
     another project, or the *JWT secret* or the project ref copied instead of
     the secret key (1.3); a message about row-level security is the
     *publishable* / `anon` key where the secret one should be. Variables only
     reach the application on the next deploy.
   - A toast saying only *O armazenamento de arquivos não respondeu* means the
     browser's own upload to Supabase got no answer — the network, or a CORS
     preflight refused. The browser console (F12) has the reason.
   - *O armazenamento recusou o arquivo (413)* or *(415)* is a size or type
     restriction set on the bucket itself, in the Supabase dashboard.
   - An existing file that 404s is the bucket name again; a 503 is the store
     not answering the signing request.
3. **Look at a deadline.** A task due today must read "hoje". This was wrong in
   every zone west of UTC until the calendar-date repair.
4. **Move a card, then check `activity_logs` has a row** (Supabase → *Table
   Editor*). That is the outbox draining; if it does not, `after()` is not
   running on this deployment.
5. **Try passwords, then accounts.** On `/register`, type `senha123`: the field
   says it is one of the most used, and pressing *Criar conta* sends nothing.
   Refused passwords never count (ADR 0008), so ten of them in a row must not
   bring *Muitos cadastros*. Then create six accounts inside a minute, each
   with a new address and an accepted password: the sixth must be refused. If
   it is *not*, or if the first is, the limiter is not resolving client IPs —
   see `advanced.ipAddress` in `src/server/auth/config.ts`, and look in
   Supabase at `select key from rate_limits where key like 'planora:signUp:%';`
   — it must show your own address, not `unresolved`.

### When something fails

- **Build log** — Vercel → the deployment → *Building*. Migration errors are
  here.
- **Runtime log** — Vercel → *Logs*. A 500 on a page is here, with the digest
  the error screen showed.
- **The database** — Supabase → *Table Editor* and *SQL Editor*.

## Region

`vercel.json` pins the functions to `gru1` (São Paulo), matching a Supabase
project in `sa-east-1`. On the Hobby plan a project runs in one region, and
Vercel's default for a new project is `iad1` (Washington). A function in
Virginia talking to a database in São Paulo pays that distance on every query,
and each screen makes several — so if you ever move one, move both.
