# Status

**Phase 0 is complete.** `pnpm verify` is green in CI on a repository that does
nothing yet — the criterion in `DEVELOPMENT_PLAN.md` §7. **Next up: Phase 1.**

Remote: https://github.com/solucoesjhg/planora (private)

## Done

- Repository at `~/dev/planora`, Git from the first commit.
- Next 16.3.4 · React 19.2.8 · TypeScript strict with `noUncheckedIndexedAccess`.
- ESLint 9 flat config with the `domain/` boundary rule.
- Vitest (unit, `src/**/*.test.ts`) and Playwright (`tests/e2e/`) configured.
- Folder shape of §2.6 in place; `src/lib/result.ts` with its test.
- `.env.example` versioned; `pnpm verify` = typecheck + lint + test + build.
- GitHub Actions workflow `.github/workflows/verify.yml`.
- Design tokens and assets copied from the legacy directory into `docs/design/`
  and `public/`; the legacy directory is read-only from here on.
- `AGENTS.md` carries the working rules (`CLAUDE.md` points at it, and the Next
  managed block stays at the top of the file); ADR 0001 written.

## Next

- Phase 1: the five pure domain modules with their tests, before any database
  and before any screen.

## Blocked / open

- **Docker is not installed on this machine**, so the Supabase CLI local stack
  cannot be started. Nothing in Phase 0 needs a running database, but Phase 2
  does: install Docker Desktop, then `supabase init` and `supabase start`.
  The values in `.env.example` already assume the CLI stack's local ports.
- Next scaffolded **16.3.4**, slightly ahead of the 16.2.6 the plan cites. No
  behavioural difference for anything written so far.
- CI warns that `actions/checkout@v4`, `actions/setup-node@v4` and
  `pnpm/action-setup@v4` target Node 20, which GitHub has deprecated; the runner
  forces Node 24 and the job passes. Bump the action versions when convenient.
- `typecheck` runs `next typegen` first: `LayoutProps` and the other route-type
  helpers are generated, and a clean checkout has none. Deleting `.next` before
  `pnpm verify` reproduces what CI sees.
