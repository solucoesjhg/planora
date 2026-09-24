/**
 * The tenant context (DEVELOPMENT_PLAN.md §2.4, §4.2.1).
 *
 * Every repository takes one as its first argument, and no query runs without
 * `workspace_id` in its `where`. In Phase 3 the DAL becomes the only thing that
 * can produce one, from a session; until then the seed and the tests assemble
 * it directly, which is also how they stay testable afterwards.
 */

import type { ROLES } from "@/server/db/schema";

export type Role = (typeof ROLES)[number];

export type TenantContext = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: Role;
  /**
   * Who is really acting, when it is not the person (§4.6): a rule runs with
   * the permissions of the workspace but signs as `automation`, and carries
   * the event that caused it so the engine can see how deep a chain has got.
   */
  readonly actor?: {
    readonly kind: "automation" | "ai";
    readonly causedBy: string;
    readonly depth: number;
  };
};

export type Action =
  | "read"
  | "write-task"
  | "manage-project"
  | "manage-column"
  | "manage-members"
  | "delete-workspace";

const PERMISSIONS: Record<Role, readonly Action[]> = {
  owner: [
    "read",
    "write-task",
    "manage-project",
    "manage-column",
    "manage-members",
    "delete-workspace",
  ],
  admin: ["read", "write-task", "manage-project", "manage-column", "manage-members"],
  manager: ["read", "write-task", "manage-project", "manage-column"],
  member: ["read", "write-task"],
  viewer: ["read"],
};

export function can(context: TenantContext, action: Action): boolean {
  return PERMISSIONS[context.role].includes(action);
}

/** Highest first: the order §4.2.1's table reads in. */
const RANK: readonly Role[] = ["owner", "admin", "manager", "member", "viewer"];

/**
 * The roles this person may hand out in an invitation (ADR 0003).
 *
 * Nobody grants a role above their own, and nobody grants ownership: there is
 * one owner per workspace, and a transfer, when there is one, is its own act.
 * So an owner or an admin may invite an admin, a manager, a member or a viewer,
 * and whoever cannot manage members may invite nobody.
 */
export function grantableRoles(context: TenantContext): readonly Role[] {
  if (!can(context, "manage-members")) return [];
  const own = RANK.indexOf(context.role);
  return RANK.filter((role, rank) => role !== "owner" && rank >= own);
}

/** Assembled by the seed and by tests; Phase 3 adds `requireWorkspace()`. */
export function tenantContext(
  workspaceId: string,
  userId: string,
  role: Role = "owner",
): TenantContext {
  return { workspaceId, userId, role };
}

/**
 * The actor fields of an event this context emits. A person signs with their
 * id; a rule signs as `automation` with no id, and passes on the cause — so
 * the activity feed reads "Planora …", and a rule that triggers a rule is
 * counted rather than hidden.
 */
export function provenance(context: TenantContext): {
  actorKind: "user" | "automation" | "ai";
  actorId: string | null;
  causedBy: string | null;
  depth: number;
} {
  if (!context.actor) return { actorKind: "user", actorId: context.userId, causedBy: null, depth: 0 };
  return {
    actorKind: context.actor.kind,
    actorId: null,
    causedBy: context.actor.causedBy,
    depth: context.actor.depth,
  };
}
