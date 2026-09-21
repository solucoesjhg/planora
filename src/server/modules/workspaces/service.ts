/**
 * Invitations (DEVELOPMENT_PLAN.md §7 Phase 3).
 *
 * The one place a second person can enter a workspace. It exists now because
 * account verification and password reset already needed the email plumbing —
 * not because the MVP asks anybody to invite a team.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { isRefused, ok, refused, type Result } from "@/lib/result";
import { hashToken, randomToken } from "@/lib/token";
import { can, provenance, type Role, type TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
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

export type PrepareFailure = "forbidden" | "already-member" | "already-invited";

export type InviteFailure = PrepareFailure | "undeliverable";

export type InviteInput = {
  readonly email: string;
  readonly role?: Role;
  readonly baseUrl: string;
  readonly sender: EmailSender;
  readonly now?: Date;
};

/**
 * The row the message is about, carried from the scope that wrote it to the
 * one that finishes it.
 *
 * The token lives here and in the link, never in a column: what is stored is
 * its SHA-256, which is why this has to be handed on rather than read back.
 */
export type PreparedInvitation = {
  readonly invitationId: string;
  readonly token: string;
  readonly email: string;
  readonly role: Role;
  readonly workspaceName: string;
  readonly invitedByName: string;
};

/**
 * Everything the invitation decides and writes, and nothing that waits on the
 * network — so this is the part that belongs inside the scope (ADR 0002).
 */
export async function prepareInvitation(
  executor: Executor,
  context: TenantContext,
  input: { readonly email: string; readonly role?: Role; readonly now?: Date },
): Promise<Result<PreparedInvitation, PrepareFailure>> {
  if (!can(context, "manage-members")) return refused("forbidden", context.role);

  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();
  const role = input.role ?? "member";

  const [existingMember] = await executor
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

  const [invitation] = await executor
    .insert(workspaceInvitations)
    .values({
      workspaceId: context.workspaceId,
      email,
      role,
      tokenHash: await hashToken(token),
      invitedBy: context.userId,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: workspaceInvitations.id });

  if (!invitation) return refused("already-invited", email);

  const [workspace] = await executor
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, context.workspaceId))
    .limit(1);

  const [invitedBy] = await executor
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, context.userId))
    .limit(1);

  return ok({
    invitationId: invitation.id,
    token,
    email,
    role,
    workspaceName: workspace?.name ?? "Planora",
    invitedByName: invitedBy?.name ?? "Alguém",
  });
}

/**
 * The message. It takes no executor because it is the one step that leaves
 * this machine: a pooled backend held open across a Resend call is idle in
 * transaction, and the role's timeout is the backstop, not the design.
 */
export async function deliverInvitation(
  sender: EmailSender,
  baseUrl: string,
  prepared: PreparedInvitation,
): Promise<Result<undefined, "undeliverable">> {
  try {
    await sender.send(
      invitationEmail({
        to: prepared.email,
        workspaceName: prepared.workspaceName,
        invitedByName: prepared.invitedByName,
        url: `${baseUrl}/invitations/${prepared.token}`,
      }),
    );
    return ok(undefined);
  } catch (error) {
    return refused(
      "undeliverable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * The row exists and the link is only in that message: if it cannot be
 * delivered, the invitation must not survive. Resend refuses outright when the
 * sender is its test domain and the recipient is anybody but the account
 * holder — which used to leave a pending invitation nobody could receive and
 * nobody could cancel, since a second attempt answers "already invited".
 */
export async function discardInvitation(
  executor: Executor,
  invitationId: string,
): Promise<void> {
  await executor
    .delete(workspaceInvitations)
    .where(eq(workspaceInvitations.id, invitationId));
}

/** Delivered, so it happened: the event is written once the message is out. */
export async function confirmInvitation(
  executor: Executor,
  context: TenantContext,
  prepared: PreparedInvitation,
): Promise<void> {
  await emit(executor, {
    workspaceId: context.workspaceId,
    type: "member.invited",
    payload: {
      invitationId: prepared.invitationId,
      email: prepared.email,
      role: prepared.role,
    },
    dedupeKey: `member.invited:${prepared.invitationId}`,
    ...provenance(context),
  });
}

/**
 * The whole invitation against a single executor, in order.
 *
 * The Server Action does not call this one: it runs the same four steps with
 * the writing scope closed around the first and the last, so the wait on the
 * mail provider happens with no transaction open (ADR 0002). This is the shape
 * a test or a script wants — one executor, one call — and it is what keeps the
 * ordering the phases depend on written down in one place.
 */
export async function inviteMember(
  executor: Executor,
  context: TenantContext,
  input: InviteInput,
): Promise<Result<{ invitationId: string; token: string }, InviteFailure>> {
  const prepared = await prepareInvitation(executor, context, input);
  if (isRefused(prepared)) return prepared;

  const delivered = await deliverInvitation(input.sender, input.baseUrl, prepared.value);
  if (isRefused(delivered)) {
    await discardInvitation(executor, prepared.value.invitationId);
    return delivered;
  }

  await confirmInvitation(executor, context, prepared.value);
  return ok({
    invitationId: prepared.value.invitationId,
    token: prepared.value.token,
  });
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
 *
 * The page it feeds arrives with a token and no session, so the executor it is
 * handed comes from `withInvitation`, the lane whose policy compares the same
 * hash this computes (ADR 0002).
 */
export async function previewInvitation(
  executor: Executor,
  token: string,
  now: Date = new Date(),
): Promise<InvitationPreview> {
  const tokenHash = await hashToken(token);

  const [row] = await executor
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

/**
 * Joining. It writes the membership every other policy resolves through, so
 * there is nothing yet for the tenant lane to check it against: the executor
 * has to come from the system lane, and the transaction below stays its own
 * (ADR 0002). Handed one, it becomes a savepoint inside it.
 */
export async function acceptInvitation(
  executor: Executor,
  input: { token: string; userId: string; now?: Date },
): Promise<Result<{ workspaceId: string; role: Role }, AcceptFailure>> {
  const now = input.now ?? new Date();

  const tokenHash = await hashToken(input.token);

  return executor.transaction(async (tx) => {
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
  executor: Executor,
  context: TenantContext,
  now: Date = new Date(),
) {
  return executor
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


/* ------------------------------------------------------------------ *
 * The Danger Zone (§6.2, §7 Phase 8)
 * ------------------------------------------------------------------ */

export type DeleteWorkspaceFailure = "forbidden" | "not-found" | "mismatch";

/**
 * The whole workspace, gone: projects, tasks, files' rows, members,
 * invitations, events — every table hangs off `workspaces.id` with a cascade.
 * Only the owner may, and only by typing the workspace's name: the check is
 * here, not only in the dialog, because a Server Action is a URL. The person
 * keeps their account; the next request repairs them a fresh personal
 * workspace, the way signup does.
 */
export async function deleteWorkspace(
  executor: Executor,
  context: TenantContext,
  confirmation: string,
): Promise<Result<{ workspaceId: string }, DeleteWorkspaceFailure>> {
  if (!can(context, "delete-workspace")) return refused("forbidden", context.role);

  const [workspace] = await executor
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, context.workspaceId))
    .limit(1);
  if (!workspace) return refused("not-found", context.workspaceId);
  if (confirmation.trim() !== workspace.name) return refused("mismatch");

  await executor.delete(workspaces).where(eq(workspaces.id, workspace.id));
  return ok({ workspaceId: workspace.id });
}
