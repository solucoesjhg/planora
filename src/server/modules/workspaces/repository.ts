/**
 * Workspace membership (DEVELOPMENT_PLAN.md §2.4, §4.2.1).
 *
 * These functions know nothing about sessions or requests: the DAL feeds them
 * a user id, which is what keeps them testable without a browser.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { keyBetween } from "@/domain/kanban";
import { randomToken } from "@/lib/token";
import type { Role, TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { createExampleProject } from "@/server/modules/projects/example";
import { users, workspaceMembers, workspaces } from "@/server/db/schema";

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

export type Member = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly since: Date;
};

/** Everyone in this workspace, oldest membership first. */
export async function membersOf(
  executor: Executor,
  context: TenantContext,
): Promise<Member[]> {
  const rows = await executor
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      since: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, context.workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));

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
 *
 * Idempotent, and safe to call from two requests at once: it takes a row lock
 * on the user before deciding, so the second caller sees the first one's work
 * instead of creating a second workspace. Better Auth's `after` hook runs
 * outside the transaction that created the account, so this is also the repair
 * path — an account that somehow has no workspace gets one on first use rather
 * than a 404.
 *
 * The workspace and the membership it writes are what every policy resolves
 * through, so at this moment there is no membership for one to check: the
 * executor has to come from the system lane (ADR 0002). The transaction stays
 * its own, and becomes a savepoint when it is handed one.
 */
export async function ensurePersonalWorkspace(
  executor: Executor,
  user: { id: string; name: string; email: string },
): Promise<string> {
  return executor.transaction(async (tx) => {
    // Serializes concurrent repairs for this user, and nothing else.
    await tx.execute(sql`select id from users where id = ${user.id} for update`);

    const existing = await membershipsOf(tx, user.id);
    const owned = existing.find((membership) => membership.role === "owner");
    if (owned) return owned.workspaceId;

    const workspaceId = await createPersonalWorkspace(tx, user);

    /**
     * A first screen with something on it. Nested so it runs inside its own
     * savepoint: a failed statement aborts the whole transaction in Postgres,
     * and an example project is not worth losing a signup over.
     */
    try {
      await tx.transaction(async (nested) => {
        await createExampleProject(nested, {
          workspaceId,
          userId: user.id,
          role: "owner",
        });
      });
    } catch {
      // The savepoint rolled back; the workspace survives and the person can
      // create their own project.
    }

    return workspaceId;
  });
}

export async function createPersonalWorkspace(
  executor: Executor,
  user: { id: string; name: string; email: string },
): Promise<string> {
  const name = user.name.trim().length > 0 ? user.name.trim() : "Meu espaço";

  /**
   * Two people signing up at the same second with the same name would both
   * find the slug free and both try to take it. So the database decides:
   * claim it, and if it is gone, fall back to a slug carrying the user id —
   * which is unique by construction. `onConflictDoNothing` returns no row
   * instead of aborting the transaction, which a raised constraint would.
   */
  const base = slugify(name);

  /**
   * The fallbacks read from the **end** of the id, never the start: a UUID v7
   * begins with a millisecond timestamp, so accounts created in the same
   * instant share their first characters — which is exactly the case this
   * fallback exists for. The last group is random.
   */
  let workspace: { id: string } | null = null;
  for (const slug of [
    base,
    `${base}-${user.id.slice(-8)}`,
    `${base}-${randomToken(4)}`,
  ]) {
    workspace = await claimSlug(executor, name, slug, user.id);
    if (workspace) break;
  }

  if (!workspace) throw new Error("could not claim a workspace slug");

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

async function claimSlug(
  executor: Executor,
  name: string,
  slug: string,
  userId: string,
): Promise<{ id: string } | null> {
  const [row] = await executor
    .insert(workspaces)
    .values({ name, slug, createdBy: userId })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning({ id: workspaces.id });

  return row ?? null;
}

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "espaco"
  );
}

/** Ordering key for the first project in a fresh workspace. */
export const firstPosition = () => keyBetween(null, null);
