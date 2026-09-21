-- Phase 10 · the roles and the resolvers (DEVELOPMENT_PLAN.md §2.4, ADR 0002).
--
-- This migration creates the barrier's machinery and grants nothing dangerous.
-- The policies themselves arrive in 0009, so this one can land, be exercised
-- and be rolled back without changing what any query returns.
--
-- The roles are created NOLOGIN and without a password: a migration lives in
-- git, and a password in git is not a password. Whoever operates the
-- deployment gives them one out of band — `alter role planora_app with login
-- password '…'` — and the test harness does the same locally with a throwaway.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- The application's role. No BYPASSRLS, not the owner, and — once 0009 runs —
-- subject to every policy including on tables it can write.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'planora_app') THEN
    CREATE ROLE planora_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- The four paths that are cross-workspace by construction (ADR 0002): Better
-- Auth's own tables, the outbox dispatcher and the clock, email delivery and
-- digests, and the signup path that writes a person's first workspace and
-- membership before there is a membership to check them against.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'planora_system') THEN
    CREATE ROLE planora_system NOLOGIN BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- A scope that awaits the network between two statements holds a pooler
-- backend open; the services are written not to, and this is the backstop.
ALTER ROLE planora_app SET idle_in_transaction_session_timeout = '10s';
--> statement-breakpoint

-- The sentinel that makes a forgotten scope loud. It is deliberately not a
-- uuid: a statement that reaches the database outside any lane raises 22P02
-- rather than returning an empty result, because an empty board nobody reports
-- for a week is the worse failure.
ALTER ROLE planora_app SET planora.workspace_id = 'unset';
--> statement-breakpoint

ALTER ROLE planora_app SET planora.user_id = '';
--> statement-breakpoint

GRANT USAGE ON SCHEMA public, app TO planora_app, planora_system;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO planora_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO planora_system;
--> statement-breakpoint

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO planora_app, planora_system;
--> statement-breakpoint

-- The identity tables are Better Auth's, and Better Auth runs on the system
-- lane. `planora_app` holding SELECT on `sessions` would mean a wrong tenant
-- context could read session tokens in plaintext, which is a larger prize than
-- the rows the barrier is protecting.
REVOKE ALL ON TABLE sessions, accounts, verifications, rate_limits FROM planora_app;
--> statement-breakpoint

-- `users` stays readable, because the board names assignees and the members
-- screen names people — but a policy in 0009 decides which people, and nothing
-- on the app lane writes a user.
REVOKE INSERT, UPDATE, DELETE ON TABLE users FROM planora_app;
--> statement-breakpoint

-- A table added later inherits the grants rather than being forgotten. The
-- catalog test in the suite is what catches the policy that goes with it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO planora_app, planora_system;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO planora_app, planora_system;
--> statement-breakpoint

-- Who the request says it is. Unset yields NULL rather than raising, so the
-- lanes that legitimately have no workspace still evaluate.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('planora.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- The workspace the request may see — resolved, not believed.
--
-- The setting says which workspace the application thinks it is in; this
-- returns it only when `workspace_members` agrees that the user is in it. That
-- is the whole difference between a policy that catches a missing `where`
-- clause and one that catches a wrong `TenantContext`, which is the failure
-- §2.4 says this barrier exists for.
--
-- SECURITY DEFINER because the function reads `workspace_members`, which 0009
-- policies and FORCEs: it must run as the owner, which bypasses RLS, or the
-- policy would call the function that reads the table that applies the policy.
-- `search_path` is pinned and EXECUTE is revoked from PUBLIC, which is what
-- makes a SECURITY DEFINER function safe to own.
CREATE OR REPLACE FUNCTION app.current_workspace() RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT m.workspace_id
  FROM public.workspace_members m
  WHERE m.workspace_id = current_setting('planora.workspace_id', true)::uuid
    AND m.user_id = app.current_user_id()
$$;
--> statement-breakpoint

-- The invitation lane: one page is reached by a token instead of a session, so
-- it has no user and no workspace. The token's hash is what it carries.
CREATE OR REPLACE FUNCTION app.current_invitation() RETURNS text
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('planora.invitation_token_hash', true), '')
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.current_workspace() FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.current_invitation() FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.current_workspace(), app.current_user_id(), app.current_invitation()
  TO planora_app, planora_system;
