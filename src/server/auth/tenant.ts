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

/** Assembled by the seed and by tests; Phase 3 adds `requireWorkspace()`. */
export function tenantContext(
  workspaceId: string,
  userId: string,
  role: Role = "owner",
): TenantContext {
  return { workspaceId, userId, role };
}
