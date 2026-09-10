# Deploying Planora

The first deployed environment (DEVELOPMENT_PLAN.md §7 Phase 3). It exists
because verification and invitation links need a real URL, and because a
managed Postgres behaves differently from one in Docker.

**It is private until Phase 11.** Rate limiting is on, but RLS, the full
security headers and the restore drill land in Phase 10 — so this is your own
account and nobody else's data until then.

---

## What only you can do

Three accounts, in this order. Nothing here should ever be pasted into a chat
or committed: every value belongs in Vercel's environment variables.

### 1. Supabase — the database and the bucket

1. Create a project. **Pick the region nearest the Vercel region** below;
   every request pays that distance twice.
2. Save the database password it shows you once.
3. Under *Storage*, create a bucket named `attachments` and leave it
   **private**. Nothing reads it without a URL this application signs.
4. Under *Project Settings → API*, copy the project URL and the
   **service role** key. That key bypasses every policy: it lives in Vercel,
   never in the browser, and never in the repository.
5. Under *Connect*, copy both connection strings:
   - the **transaction pooler** (port `6543`) — the application's,
   - the **direct connection** (port `5432`) — migrations only.

### 2. Resend — the email

Account verification does not work without it, and the application refuses to
start in production rather than post mail to a local inbox that is not there.

1. Create an account and an API key.
2. Verify a domain, or use Resend's onboarding sender while testing.
3. `EMAIL_FROM` must match a sender that domain allows.

**The onboarding sender only delivers to you.** With
`EMAIL_FROM="Planora <onboarding@resend.dev>"`, Resend accepts every message
but delivers only to the address that owns the account — anything else is
dropped, with a 200 and no bounce. So the first signup works, an invitation to
a colleague appears to send and never arrives, and nothing in the logs says
why. Verify a domain before inviting anybody who is not you.

### 3. Vercel — the deployment

1. Import `solucoesjhg/planora`. The framework is detected; the build command
   comes from `vercel-build` in `package.json`, which migrates first.
2. Add the environment variables below, for **Production**.
3. Deploy. Then set `BETTER_AUTH_URL` to the URL it gives you and redeploy —
   the links in every email are built from it.

---

## Environment variables

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **pooler**, port 6543 | the application's connection |
| `MIGRATION_DATABASE_URL` | Supabase **direct**, port 5432 | drizzle-kit keeps a session and takes a lock; a pooler will not hold either. The build refuses a pooler URL here |
| `BETTER_AUTH_SECRET` | 32+ random characters | signs sessions, verification links and file URLs. `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | the deployment's URL | what people open; every emailed link is built from it |
| `SUPABASE_URL` | project URL | Storage only — the SDK appears in exactly one file |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | server-side only |
| `SUPABASE_STORAGE_BUCKET` | `attachments` | |
| `RESEND_API_KEY` | Resend key | required in production |
| `EMAIL_FROM` | `Planora <no-reply@yourdomain>` | must match a verified sender |

Deliberately **not** set: `STORAGE_DRIVER`. With Supabase configured the bucket
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
- migrations use the direct connection, and the script refuses to run if it is
  handed the pooler.

Migrations are never applied by hand from a laptop (§7 Phase 3).

---

## After the first deploy

Check these in order — each one has already been the cause of a failure here:

1. **Sign up with a real address.** The email must arrive from Resend, and its
   link must point at the deployment rather than `localhost`. If it points at
   localhost, `BETTER_AUTH_URL` is wrong or was set after the build.
2. **Open a task and attach a file.** The URL should be
   `/api/attachments/<id>` and redirect to a `supabase.co` signed URL. If the
   file 404s, the bucket name does not match `SUPABASE_STORAGE_BUCKET`.
3. **Look at a deadline.** A task due today must read "hoje". This was wrong in
   every zone west of UTC until the calendar-date repair.
4. **Move a card, then check `activity_logs` has a row.** That is the outbox
   draining; if it does not, `after()` is not running on this deployment.
5. **Try signing up six times in a minute.** The sixth must be refused. If it
   is *not*, or if the first is, the rate limiter is not resolving client IPs —
   see `advanced.ipAddress` in `src/server/auth/config.ts`.

## Region

`vercel.json` pins the functions to `gru1` (São Paulo), matching a Supabase
project in `sa-east-1`. Change both together if you ever move one — a function in Virginia talking to a database in
São Paulo pays ~200ms on every query, and this application makes several per
page.
