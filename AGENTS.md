<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Planora

A project operating system: Kanban with phase-weighted progress, an explaining
health engine, blocking rules and automatic phase history.

**`docs/DEVELOPMENT_PLAN.md` is the reference.** Read the section covering the
area before writing code in it. `docs/STATUS.md` says where the work stopped.
Decisions live in `docs/adr/`.

## The rule that matters most

`src/domain/` is pure: no React, no Next, no Drizzle, no `server/`, no `app/`.
It may import only `domain/` and `lib/`. The board imports `canMoveTask()` to
bounce a card before any request; the service imports the same function to
decide whether to write. One rule, two consumers. ESLint enforces it and CI
fails on a violation — do not work around the rule, change the design.

Business logic never lives in a React component. If it is a rule, it belongs in
`domain/`, with a test.

## Layout

```
src/app/          routes, layouts, Server Components — read via the DAL, write via Server Actions, zero calculation
src/features/     client islands (board drag, forms, editor); may import domain/
src/components/   dumb reusable UI, props and tokens only
src/domain/       pure functions: progress · health · kanban · dependencies · phase-history
src/server/auth/  the DAL: requireSession(), requireWorkspace() — server-only
src/server/modules/<module>/   actions → services → repositories
src/server/events/             outbox writer and dispatcher
src/server/db/                 Drizzle schema, migrations, seed
src/server/storage/            the single Supabase Storage adapter
src/fixtures/     sample data for tests and /_dev routes — never inside a component
src/lib/          shared utilities and the Result type; never a business rule
tests/e2e/        Playwright; unit tests sit beside their modules as *.test.ts
```

## How work flows

```
read    Server Component → requireWorkspace() → queries → render
write   client → Server Action (Zod) → service → domain → repository
                                    └→ outbox_events, same transaction
```

Every repository takes a `TenantContext` as its first argument, and only the DAL
produces one. No query runs without `workspace_id` in its `where`.

Domain refusals are values, not exceptions: `Allowed | Refused(reason)` from the
domain, `Ok | Refused(reason)` from a service (`src/lib/result.ts`). A thrown
error means something unexpected.

## Before opening a pull request

1. Read the plan section for the area, and any ADR it references.
2. Reuse the existing service, repository or domain module — never duplicate it.
3. Add or update the test that proves the behaviour.
4. `pnpm verify` (typecheck, lint, test, build) must pass.
5. If a new rule or constraint was discovered, write the ADR first.
6. Update `docs/STATUS.md` when a phase ends or a session stops mid-phase.

One phase, one branch, one pull request. No phase begins with a red test.

## Conventions

- Code, schema, comments and commits in **English**; interface strings in
  **pt-BR** (plan, Appendix B). A pt-BR label never becomes an identifier.
- Commands: `pnpm dev`, `pnpm verify`, `pnpm test:watch`, `pnpm e2e`.
- Services: `docker compose up -d` starts Postgres (54322) and the local inbox
  Mailpit (http://localhost:8025). Then `pnpm test:db` with `DATABASE_URL`
  pointing at `postgresql://postgres:postgres@127.0.0.1:54322/planora_dev`, and
  `pnpm e2e` for Playwright. Integration tests skip themselves when that
  variable is absent; no email leaves the machine in development.
- The legacy directory `C:\Users\henri\.antigravity\Planora` is **read-only** —
  a requirements source and an asset library, never an import target.
