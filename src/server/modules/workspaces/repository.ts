/**
 * Workspace membership (DEVELOPMENT_PLAN.md §2.4, §4.2.1).
 *
 * These functions know nothing about sessions or requests: the DAL feeds them
 * a user id, which is what keeps them testable without a browser.
 */

import { and, asc, eq } from "drizzle-orm";
import { keyBetween } from "@/domain/kanban";
import type { Role, TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { workspaceMembers, workspaces } from "@/server/db/schema";

export type Membership = {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: Role;
};

export async function membershipsOf(
  executor: Executor,
  userId: string,
): Promise<Membership[]> {
  const rows = await executor
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));

  return rows.map((row) => ({ ...row, role: row.role as Role }));
}

/**
 * The tenant context for this user in this workspace, or null when they are
 * not a member — which is what turns a forged workspace id into a 404 rather
 * than into somebody else's board.
 */
export async function resolveTenantContext(
  executor: Executor,
  userId: string,
  workspaceId?: string,
): Promise<TenantContext | null> {
  const memberships = await membershipsOf(executor, userId);
  const membership = workspaceId
    ? memberships.find((each) => each.workspaceId === workspaceId)
    : memberships[0];

  if (!membership) return null;
  return {
    workspaceId: membership.workspaceId,
    userId,
    role: membership.role,
  };
}

/**
 * Signing up gives you a workspace of your own. Nothing of value in this
 * product sits behind "invite your team first" (§6.1).
 */
export async function createPersonalWorkspace(
  executor: Executor,
  user: { id: string; name: string; email: string },
): Promise<string> {
  const name = user.name.trim().length > 0 ? user.name.trim() : "Meu espaço";

  const [workspace] = await executor
    .insert(workspaces)
    .values({
      name,
      slug: await uniqueSlug(executor, name, user.id),
      createdBy: user.id,
    })
    .returning({ id: workspaces.id });

  if (!workspace) throw new Error("workspace insert returned nothing");

  await executor.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner",
  });

  return workspace.id;
}

export async function findMembership(
  executor: Executor,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const [row] = await executor
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  return (row?.role as Role) ?? null;
}

async function uniqueSlug(
  executor: Executor,
  name: string,
  userId: string,
): Promise<string> {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "espaco";

  const [taken] = await executor
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.slug, base))
    .limit(1);

  // The user id is already unique; a suffix from it beats a counter and a race.
  return taken ? `${base}-${userId.slice(0, 8)}` : base;
}

/** Ordering key for the first project in a fresh workspace. */
export const firstPosition = () => keyBetween(null, null);
