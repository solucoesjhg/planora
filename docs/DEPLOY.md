# Deploying Planora

The first deployed environment (DEVELOPMENT_PLAN.md §7 Phase 3). It exists
because verification and invitation links need a real URL, and because a
managed Postgres behaves differently from one in Docker.

**It is private until Phase 11.** Rate limiting is on, but RLS, the full
security headers and the restore drill land in Phase 10 — so this is your own
account and nobody else's data until then.

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
4. Create.

### 1.3 The keys

Left sidebar → **Settings** (bottom) → **API Keys**.

- **Project URL** — under *Settings → API*, looks like
  `https://abcdefgh.supabase.co`. That is `SUPABASE_URL`.
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

## Environment variables

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **pooler**, port 6543 | the application's connection |
| `MIGRATION_DATABASE_URL` | Supabase **session pooler**, port 5432 | drizzle-kit keeps a session and takes a lock; session mode gives it one backend for the run. The build refuses the transaction pooler (6543); the direct host is IPv6-only and unreachable from Vercel |
| `BETTER_AUTH_SECRET` | 32+ random characters | signs sessions, verification links and file URLs |
| `BETTER_AUTH_URL` | the deployment's URL | every emailed link is built from it |
| `SUPABASE_URL` | project URL | Storage only — the SDK appears in exactly one file |
| `SUPABASE_SERVICE_ROLE_KEY` | secret / `service_role` key | server-side only |
| `SUPABASE_STORAGE_BUCKET` | `attachments` | |
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
     is a bucket whose name does not match `SUPABASE_STORAGE_BUCKET` (1.2); a
     message about the JWT or the signature is `SUPABASE_SERVICE_ROLE_KEY`
     pasted wrong (1.3).
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
5. **Try signing up six times in a minute.** The sixth must be refused. If it
   is *not*, or if the first is, the rate limiter is not resolving client IPs —
   see `advanced.ipAddress` in `src/server/auth/config.ts`.

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
