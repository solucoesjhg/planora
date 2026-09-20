# Planora

A project operating system: a Kanban board whose columns mean something, a
progress number that reflects the state of the work rather than a count of
finished cards, a health audit that names its own reasons, blocking rules that
keep "done" honest, and tasks that keep the record of how they were done.

Interface in pt-BR; code, schema, comments and commits in English.

## Read first

- [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) — the reference. Architecture, the domain engine, the data model, the fourteen phases and their criteria.
- [`docs/STATUS.md`](docs/STATUS.md) — where the work stopped, and every decision taken since the plan.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Supabase, Resend and Vercel, in order.
- [`AGENTS.md`](AGENTS.md) — the rules for anyone, human or agent, writing code here.

## Run it

```bash
docker compose up -d      # Postgres on 54322, the local inbox (Mailpit) on 8025
cp .env.example .env.local
pnpm install
pnpm db:migrate           # with MIGRATION_DATABASE_URL pointing at the local database
pnpm dev                  # http://localhost:3000
```

Sign up; the verification email lands in Mailpit at http://localhost:8025. A
new account comes with a workspace and an example project.

## Check it

```bash
pnpm verify    # typecheck, lint, unit tests, build — what CI runs on every push
pnpm test:db   # integration tests, in their own database (planora_test, created on first run)
pnpm e2e       # Playwright, against a production build
```

The domain in `src/domain/` is pure — no React, no Next, no database — and a
lint rule keeps it that way. Every rule the interface shows is the same function
the server checks.
