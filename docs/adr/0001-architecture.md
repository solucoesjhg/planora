# 0001 — Modular monolith with a pure domain

**Date:** 2026-09-08 · **Status:** accepted

## Context

The v1 kept its rules in prose: 3,786 lines of specification against a `src/` of
956 lines, most of the behaviour living inside React components or nowhere at
all. Progress, health and movement rules were duplicated between the interface
and the database, so the two drifted and neither could be tested.

## Decision

A modular monolith in vertical slices, with `src/domain/` as a pure layer that
imports nothing from React, Next, Drizzle, `server/` or `app/`. Both the board
and the services consume the same domain functions. Authorization lives in a
Data Access Layer that produces the `TenantContext` every repository requires;
RLS arrives later as a second barrier, not as the source of truth.

The boundary is enforced by an ESLint rule (`eslint.config.mjs`) that fails CI,
because a boundary maintained by discipline alone is a boundary that erodes.

## Consequences

- A rule can be tested without a database, a browser or a server.
- The interface can refuse an invalid move before any request, using the exact
  function the server will use to refuse it again.
- Any code needing both the domain and the database goes in a service; the
  domain never grows an escape hatch.
- Framework changes stay confined to `app/`, `features/` and `server/`.

See `docs/DEVELOPMENT_PLAN.md` §2 and §3.
