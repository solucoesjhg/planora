# 0005 — The identity tables answer to their owner alone, and the Data API gets nothing

**Date:** 2026-09-24 · **Status:** accepted · amends ADR 0002

## Context

ADR 0002 left four tables outside row-level security on purpose: `sessions`,
`accounts`, `verifications` and `rate_limits` belong to Better Auth, which runs
as the owner, and `planora_app` holds no grant on them at all. Against the
application's own roles that was enough.

The application's roles are not the only ones in a Supabase database. Supabase
also serves `public` over HTTP, through its Data API (`/rest/v1`, and GraphQL
at `/graphql/v1`), as `anon` and `authenticated`, and its default privileges
give those roles every privilege on every table the owner creates there. The
security audit of 2026-09-24 asked production, and it answered: `anon` and
`authenticated` held `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
`REFERENCES` and `TRIGGER` on all four tables. With RLS off, the project's
anon key — which Supabase publishes as safe to share, and which Planora never
needed — would have read every session token in plaintext, every password hash,
and every pending reset link, and could have rewritten them. The project URL is
already public, because the Content-Security-Policy names the bucket's origin.

The API logs showed no request to the Data API. `public` has since been removed
from the exposed schemas, and the grants were revoked by hand.

## Decision

**Planora does not use the Data API, and the roles it serves hold nothing in
`public`.** Migration `0012` revokes every privilege on every table and sequence
in `public` from `anon` and `authenticated`, and changes the owner's default
privileges so that a table added later is not granted to them either. The roles
exist only on Supabase, so the migration asks before it revokes. A local or CI
database has no such roles and nothing to revoke.

**The identity tables have row-level security on, with no policy.** `ENABLE`,
not `FORCE`: the owner, which is what Better Auth and the system lane connect
as, is exempt by construction, and every other role, whatever it has been
granted, reads nothing and writes nothing. This is the barrier that holds even
if a grant comes back — a dashboard click, a restored backup, a default
privilege set by another role.

## Consequences

- The four tables are no longer an exemption from the barrier, only from its
  tenant policy. The catalog test now asserts both halves: every other table is
  `FORCE`d with a policy, and these four are enabled with none.
- A role holding every grant on `sessions` reads nothing. The suite proves it
  with a role made for the purpose, standing in for `anon`.
- Supabase's Data API and GraphQL cannot be switched back on for `public` by
  accident and become useful: they would find no table they may read. Anything
  that wants them later is a decision, with its own policies.
- Whoever operates the deployment keeps `public` out of the exposed schemas
  (`docs/DEPLOY.md` §7.6). The migration does not depend on it, and it does not
  depend on the migration.

See ADR 0002 for the lanes and the roles.
