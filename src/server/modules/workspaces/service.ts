/**
 * Invitations (DEVELOPMENT_PLAN.md §7 Phase 3).
 *
 * The one place a second person can enter a workspace. It exists now because
 * account verification and password reset already needed the email plumbing —
 * not because the MVP asks anybody to invite a team.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { ok, refused, type Result } from "@/lib/result";
import { hashToken, randomToken } from "@/lib/token";
import { can, type Role, type TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import type { EmailSender } from "@/server/email/sender";
import { invitationEmail } from "@/server/email/templates";
import { emit } from "@/server/events/outbox";

const INVITATION_DAYS = 7;

export type InviteFailure =
  | "forbidden"
  | "already-member"
  | "already-invited"
  | "undeliverable";

export type InviteInput = {
  readonly email: string;
  readonly role?: Role;
  readonly baseUrl: string;
  readonly sender: EmailSender;
  readonly now?: Date;
};

export async function inviteMember(
  db: Database,
  context: TenantContext,
  input: InviteInput,
): Promise<Result<{ invitationId: string; token: string }, InviteFailure>> {
  if (!can(context, "manage-members")) return refused("forbidden", context.role);

  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();

  const [existingMember] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, context.workspaceId),
        eq(users.email, email),
      ),
    )
    .limit(1);

  if (existingMember) return refused("already-member", email);

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 86_400_000);

  const [invitation] = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId: context.workspaceId,
      email,
      role: input.role ?? "member",
      tokenHash: await hashToken(token),
      invitedBy: context.userId,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: workspaceInvitations.id });

  if (!invitation) return refused("already-invited", email);

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, context.workspaceId))
    .limit(1);

  const [invitedBy] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, context.userId))
    .limit(1);

/**
   * The row exists and the link is only in this message: if it cannot be
   * delivered, the invitation must not survive. Resend refuses outright when
   * the sender is its test domain and the recipient is anybody but the account
   * holder — which used to leave a pending invitation nobody could receive
   * and nobody could cancel, since a second attempt answers "already invited".
   */
  try {
    await input.sender.send(
      invitationEmail({
        to: email,
        workspaceName: workspace?.name ?? "Planora",
        invitedByName: invitedBy?.name ?? "Alguém",
        url: `${input.baseUrl}/invitations/${token}`,
      }),
    );
  } catch (error) {
    await db
      .delete(workspaceInvitations)
      .where(eq(workspaceInvitations.id, invitation.id));

    return refused(
      "undeliverable",
      error instanceof Error ? error.message : String(error),
    );
  }

  await emit(db, {
    workspaceId: context.workspaceId,
    type: "member.invited",
    payload: { invitationId: invitation.id, email, role: input.role ?? "member" },
    dedupeKey: `member.invited:${invitation.id}`,
    actorKind: "user",
    actorId: context.userId,
  });

  return ok({ invitationId: invitation.id, token });
}

export type InvitationPreview =
  | {
      readonly status: "open";
      readonly workspaceId: string;
      readonly workspaceName: string;
      readonly invitedByName: string;
      readonly role: Role;
    }
  | { readonly status: "expired" | "used" | "invalid" };

/**
 * What the page shows before the person decides. Reading is not accepting: a
 * link a mail client prefetched must not join anybody to anything.
 */
export async function previewInvitation(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<InvitationPreview> {
  const tokenHash = await hashToken(token);

  const [row] = await db
    .select({
      acceptedAt: workspaceInvitations.acceptedAt,
      expiresAt: workspaceInvitations.expiresAt,
      role: workspaceInvitations.role,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      invitedByName: users.name,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .innerJoin(users, eq(users.id, workspaceInvitations.invitedBy))
    .where(eq(workspaceInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!row) return { status: "invalid" };
  if (row.acceptedAt) return { status: "used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: "expired" };

  return {
    status: "open",
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    invitedByName: row.invitedByName,
    role: row.role as Role,
  };
}

export type AcceptFailure = "invalid-token" | "expired" | "already-member";

export async function acceptInvitation(
  db: Database,
  input: { token: string; userId: string; now?: Date },
): Promise<Result<{ workspaceId: string; role: Role }, AcceptFailure>> {
  const now = input.now ?? new Date();

  const tokenHash = await hashToken(input.token);

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.tokenHash, tokenHash),
          isNull(workspaceInvitations.acceptedAt),
        ),
      )
      .limit(1);

    // The token is never echoed back: an error message is not a lookup service.
    if (!invitation) return refused("invalid-token");
    if (invitation.expiresAt.getTime() <= now.getTime()) {
      return refused("expired", invitation.expiresAt.toISOString());
    }

    const [already] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, invitation.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      )
      .limit(1);

    if (already) return refused("already-member", invitation.workspaceId);

    await tx.insert(workspaceMembers).values({
      workspaceId: invitation.workspaceId,
      userId: input.userId,
      role: invitation.role,
    });

    await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: now })
      .where(eq(workspaceInvitations.id, invitation.id));

    return ok({
      workspaceId: invitation.workspaceId,
      role: invitation.role as Role,
    });
  });
}

/** Live invitations, for the members screen that arrives with Phase 5. */
export async function pendingInvitations(
  db: Database,
  context: TenantContext,
  now: Date = new Date(),
) {
  return db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, context.workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        gt(workspaceInvitations.expiresAt, now),
      ),
    );
}

