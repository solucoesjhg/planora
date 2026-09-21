-- Phase 10 · the barrier itself (DEVELOPMENT_PLAN.md §2.4, ADR 0002).
--
-- 0008 built the roles and the resolvers and changed nothing. This file is the
-- one that turns the barrier on, in a single reviewable place.
--
-- FORCE, not just ENABLE: without it the table's owner is exempt from its own
-- policies, and the owner is what migrations and the test harness connect as —
-- so the suite would prove the policies exist and never that they hold.
--
-- One note on ownership, because the design depends on it: `app.current_workspace()`
-- is SECURITY DEFINER and reads `workspace_members`, which is policied below.
-- That terminates because the function runs as the owner and the owner bypasses
-- RLS. If this database is ever migrated by a non-superuser owner without
-- BYPASSRLS, the policy would call the function that reads the table that
-- applies the policy. Migrations run as the owner (§7 Phase 3), and that is the
-- reason.

-- The seventeen tables whose only tenant question is `workspace_id`. Written as
-- a loop rather than fifty-one near-identical lines, so that what is uniform
-- about them is visible instead of asserted.
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'activity_logs',
    'attachments',
    'automation_runs',
    'automations',
    'board_columns',
    'clients',
    'notification_preferences',
    'notifications',
    'outbox_events',
    'project_health_snapshots',
    'projects',
    'task_assignees',
    'task_checklist_items',
    'task_comments',
    'task_dependencies',
    'task_phase_history',
    'tasks'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (workspace_id = app.current_workspace()) WITH CHECK (workspace_id = app.current_workspace())',
      tenant_table || '_tenant',
      tenant_table
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- The invitation is the authorization, and three other tables have to say so.
--
-- The page that opens a token shows which workspace, and who sent it; and
-- accepting writes the first membership this person has in that workspace. On
-- the invitation lane there is no workspace yet, so `app.current_workspace()`
-- answers for nothing — the invitation's own hash is the only credential. A
-- live one is unexpired and unaccepted; anything else is a token that has
-- already been spent.
CREATE OR REPLACE FUNCTION app.invited_workspace() RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT i.workspace_id
  FROM public.workspace_invitations i
  WHERE i.token_hash = app.current_invitation()
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.invited_by() RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT i.invited_by
  FROM public.workspace_invitations i
  WHERE i.token_hash = app.current_invitation()
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.invited_workspace(), app.invited_by() FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.invited_workspace(), app.invited_by()
  TO planora_app, planora_system;
--> statement-breakpoint

-- `workspace_members` is the bootstrap: the DAL resolves which workspaces a
-- person belongs to before any workspace is known, so the read side also
-- answers to the user alone.
--
-- The write side does not. WITH CHECK binds every insert and update to the
-- workspace the request already belongs to, which is what stops the one
-- escalation this design would otherwise open: a row `(some other workspace,
-- me, owner)` would make `app.current_workspace()` resolve for that workspace
-- and every other policy here would follow it. Who may change a role *within* a
-- workspace stays the service's question (§4.4), not the database's — this is a
-- tenant barrier, not a permission system.
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_members_tenant ON public.workspace_members
  USING (user_id = app.current_user_id() OR workspace_id = app.current_workspace())
  WITH CHECK (
    workspace_id = app.current_workspace()
    -- Accepting an invitation writes the first membership somebody has in a
    -- workspace, which by definition no membership can authorize. The live
    -- invitation is what does, and only for the person presenting it.
    OR (workspace_id = app.invited_workspace() AND user_id = app.current_user_id())
  );
--> statement-breakpoint

-- An invitation is opened from a mail client by somebody who may have no
-- account yet, so that one page arrives with a token and nothing else. The
-- token itself is never stored; its SHA-256 is.
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_invitations_tenant ON public.workspace_invitations
  USING (workspace_id = app.current_workspace() OR token_hash = app.current_invitation())
  WITH CHECK (workspace_id = app.current_workspace());
--> statement-breakpoint

-- The workspace row itself: the one the request is in, and the ones the account
-- menu offers to switch to.
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_tenant ON public.workspaces
  USING (
    id = app.current_workspace()
    OR id = app.invited_workspace()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = workspaces.id AND m.user_id = app.current_user_id()
    )
  )
  WITH CHECK (id = app.current_workspace());
--> statement-breakpoint

-- People, not accounts. The board names an assignee and the members screen
-- names a colleague, so `users` has to be readable — but only for yourself and
-- for the people you share this workspace with. Without this policy a wrong
-- tenant context reads the name and address of everybody in the deployment.
-- Nothing on the app lane writes a user: Better Auth does, on the system lane.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_visible ON public.users
  USING (
    id = app.current_user_id()
    OR id = app.invited_by()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.user_id = users.id AND m.workspace_id = app.current_workspace()
    )
  );
