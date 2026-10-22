# 0009 — The preview is the pull request's own production build, in CI

**Date:** 2026-10-22 · **Status:** accepted

## Context

Phase 11 of the plan asks for "a preview environment per pull request, with its
own migrated database" and "the full E2E suite running against the preview
before merge", done when "a push opens a preview with a migrated database and
the suite passes on it before the merge button is available."

Today no pull request gets a deployment at all. `vercel.json`'s `ignoreCommand`
skips every build whose `VERCEL_ENV` is not `production`, and
`scripts/migrate.mjs` migrates production only, because a Vercel preview would
either share the production database or have none (DEPLOY.md, "What the
pipeline does"). And the suite cannot simply be pointed at a deployed URL: it
is tied to a machine it controls.

- **The server under test is configured by the suite.** `playwright.config.ts`
  starts it with `EMAIL_DRIVER=mailpit` (every sign-up is confirmed by reading
  the inbox's HTTP API), `STORAGE_DRIVER=local` (`task.spec.ts` intercepts
  `/api/files/**`, which only the local driver serves), `ENABLE_DEV_ROUTES=1`
  (the shell tests drive `/dev/ui`), a known `CRON_SECRET` (the scheduler
  tests knock with it) and `DISABLE_BREACH_CHECK=1`.
- **The suite owns the database.** `globalSetup` migrates it, gives
  `planora_app` the local throwaway password — which takes a superuser — and
  clears the rate-limit counters; `board.spec.ts` and `phase8.spec.ts` read
  rows directly.
- **Each test is its own address.** `support/test.ts` sends a per-test
  `x-forwarded-for`, so the sign-up allowance of five a minute (ADR 0008) is
  never shared between tests. On Vercel, `x-vercel-forwarded-for` wins
  (`src/server/auth/config.ts`), every test would arrive from the runner's one
  address, and the sixth sign-up of the minute would be refused.
- **A Vercel preview is behind Deployment Protection**, which automation can
  only pass with a bypass token kept as a secret.

Four ways to give a pull request its preview were weighed:

- **(A) Supabase Branching.** The Pro plan ($25 a month) plus per-branch
  compute billed by the hour, the Supabase GitHub app, and migrations in
  Supabase's own layout or `migrate.mjs` run against the branch. The suite still
  could not run unchanged: no inbox, no bucket per branch, the address problem.
- **(B) Neon through the Vercel Marketplace.** Free, a database branch per
  preview injected into the Preview environment only. It needs code — a base
  URL from `VERCEL_BRANCH_URL` in the five places that read `BETTER_AUTH_URL`,
  `migrate.mjs` migrating previews — and still leaves email (Resend's test
  sender reaches only the owner), storage (no production secret may be scoped to
  Preview) and Deployment Protection unsolved. It gives a URL a person can
  click, and the suite still cannot run against it.
- **(C) A job in CI.** The pull request built for production on the runner,
  against a Postgres of its own and a Mailpit, and the whole suite run against
  it. No account, no secret, and no cost: Actions minutes are unlimited on a
  public repository's standard runners.
- **(D) One shared non-production Supabase project for every preview.** Not
  "its own" database: two open pull requests would apply each other's
  half-finished migrations, which is exactly why `migrate.mjs` skips previews.

## Decision

**The preview of a pull request is the `e2e` job in
`.github/workflows/verify.yml`** (option C, the owner's decision of
2026-10-22). On every push to a pull request, and on every push to `main`:

- a `postgres:17` service container, empty when the job starts, is migrated by
  the suite's `globalSetup` with the same migration files production runs;
- the application is built and served for production (`pnpm build && pnpm
  start`), connecting as `planora_app`. The database is on the runner's
  `127.0.0.1`, so `appDatabaseUrl()` applies the same rule it applies on a
  laptop, and the policies bite as they do in production (ADRs 0002, 0003);
- a Mailpit service container, pinned by tag and digest, is the inbox;
- every spec runs, in Chromium, with one retry. The Playwright report, traces
  included, is uploaded as an artifact when the job fails.

The job uses no secret. Everything it needs is already in git — the throwaway
database passwords, the suite's `CRON_SECRET` and `BETTER_AUTH_SECRET` — and is
worth nothing outside the runner. `DISABLE_BREACH_CHECK=1` is accepted by the
build because the runner has no `VERCEL_ENV`; ADR 0008's guard refuses it only
for production.

**The merge button waits on it** once `e2e` is a required status check in the
`main` ruleset, beside `verify` and `database`. That is a repository setting,
made by the owner.

**Vercel previews stay skipped.** `vercel.json` and `migrate.mjs` are unchanged.
A Vercel preview would still have no database of its own, and building one
would spend build minutes on a page that answers every request with
`DATABASE_URL is not set` — or, given a database, on a deployment the suite
could not exercise for the reasons above.

The plan's "a push opens a preview with a migrated database" is read as: every
push builds the pull request for production against a freshly migrated
database of its own, and the suite has passed on it before the merge button is
available.

## Consequences

- **There is no URL to click.** Someone who wants to see a change runs it
  (`pnpm dev`, or `pnpm e2e` for the production build) or reads the uploaded
  report. A clickable preview can be added later with option B; it would sit
  beside this gate, not replace it.
- **Each push costs about ten minutes of runner time** — install, browser,
  production build, then the suite on two workers. With the ruleset's strict
  up-to-date rule, a rebase runs it again. A newer push to the same pull request
  cancels the run it supersedes.
- **A retry hides an intermittent failure as "flaky".** The report says so;
  the green tick does not. The phone's long-press test, the one known to flake
  on a loaded machine, waits for the board's own signal that the card is in
  hand rather than for a timer, so it does not need the retry.
- **The CI build is not Vercel's.** It runs `next start` on the runner, gzip
  rather than brotli, the local storage driver rather than the bucket, Mailpit
  rather than Resend. The job proves the code and the migrations; what only
  production can prove stays on DEPLOY.md's "After the first deploy" list.
- **The images move only when someone moves them.** Postgres is pinned to the
  major production runs on, as in the `database` job; Mailpit to a release tag
  and its digest. Bumping either is a deliberate change.
- **The job's name is load-bearing.** Once `e2e` is a required check, renaming
  the job blocks every merge, as renaming `verify` or `database` would.

See `docs/DEPLOY.md`, "What the pipeline does", and `docs/DEVELOPMENT_PLAN.md`
§7 Phase 11.
