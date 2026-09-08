# Status

**Phase 0 is complete** — `pnpm verify` green in CI.
**Phase 1 is on the branch `phase-1-domain`**, awaiting review and merge.

Remote: https://github.com/solucoesjhg/planora (private)

## Done

**Phase 0 — repository foundation**

- Next 16.3.4 · React 19.2.8 · TypeScript strict with `noUncheckedIndexedAccess`.
- ESLint 9 flat config with the `domain/` boundary rule; Vitest and Playwright.
- Folder shape of §2.6, `.env.example`, `pnpm verify`, GitHub Actions workflow.
- Design tokens and assets copied from the read-only legacy directory.
- `AGENTS.md` holds the working rules (`CLAUDE.md` points at it); ADR 0001.

**Phase 1 — pure domain** (61 unit tests, no database, no React)

- `progress` — phase bands, even split of a band across sibling columns,
  checklist fill, raw vs adjusted, the 99 completion lock.
- `health` — five normalized dimensions, weighted composition, the ceiling read
  from Flow and Punctuality only, `insufficient_data`, hysteresis, task and
  project findings, bottlenecks and Top 2.
- `kanban` — `canMoveTask` with its three refusals and the acknowledged retry,
  `canEditColumn`, base-62 fractional index with length-based rebalancing.
- `dependencies` — unresolved dependencies, the blocked union, blocking roots,
  cycle rejection with the offending path.
- `phase-history` — notes archived into the body under a labelled section.
- `src/fixtures/board.ts` — frozen-clock fixtures for tests and `/_dev`.

## Next

- Review and merge `phase-1-domain`.
- Phase 2 — persistence and events: Drizzle schema, first migration,
  deterministic seed, repositories taking `TenantContext`, and the transactional
  outbox.

## Blocked / open

- **Docker is not installed on this machine**, so the Supabase CLI local stack
  cannot start. Phase 2 needs it: install Docker Desktop, then `supabase init`
  and `supabase start`. `.env.example` already assumes the CLI stack's ports.
- CI warns that `actions/checkout@v4`, `actions/setup-node@v4` and
  `pnpm/action-setup@v4` target Node 20, which GitHub has deprecated; the runner
  forces Node 24 and the job passes. Bump the action versions when convenient.
- `typecheck` runs `next typegen` first: `LayoutProps` and the other route-type
  helpers are generated, and a clean checkout has none. Deleting `.next` before
  `pnpm verify` reproduces what CI sees.

## Decisions taken since the plan

- `canMoveTask` takes the board context as a named argument — dependencies
  cannot be evaluated without it. The plan's §3.6 snippet was updated to match.
- The domain treats a task in `done` as never blocked, which is the engine-side
  half of "entering done clears the block flag" (§3.4).
- Health helpers `bandOf` and `smoothVerdict` are exported so the hysteresis
  rules can be tested directly, without constructing a board per case.
