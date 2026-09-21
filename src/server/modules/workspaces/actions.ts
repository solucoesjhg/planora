"use server";

import { revalidatePath } from "next/cache";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { cookies } from "next/headers";
import { z } from "zod";
import { isRefused } from "@/lib/result";
import { hashToken } from "@/lib/token";
import { redirect } from "next/navigation";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { ROLES } from "@/server/db/schema";
import { withInvitation, withTenant, withUser } from "@/server/db/client";
import { writing, type Limited } from "@/server/limits";
import { senderFromEnvironment } from "@/server/email/sender";
import { WORKSPACE_COOKIE } from "./cookie";
import { resolveTenantContext } from "./repository";
import { HIDE_COMPLETED_COOKIE, PREFERENCE_MAX_AGE } from "./preferences";
import {
  acceptInvitation,
  confirmInvitation,
  deleteWorkspace,
  deliverInvitation,
  discardInvitation,
  prepareInvitation,
  type DeleteWorkspaceFailure,
  type InviteFailure,
} from "./service";

export type WorkspaceActionResult<Failure = string> =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Failure; readonly detail?: string };

function refusal<Failure extends string>(result: {
  readonly reason: Failure;
  readonly detail?: string;
}): WorkspaceActionResult<Failure> {
  return result.detail === undefined
    ? { ok: false, reason: result.reason }
    : { ok: false, reason: result.reason, detail: result.detail };
}

const inviteSchema = z.object({
  email: z.email().max(200),
  role: z.enum(ROLES),
});

/**
 * Inviting, in three steps because one of them waits on a mail provider.
 *
 * The row is written inside the scope, the message goes out with none open,
 * and the event is written after it has left. Holding a pooled backend across
 * a Resend call is idle-in-transaction, and the role's ten-second timeout is
 * the backstop rather than the design (ADR 0002). What the old single call
 * bought is kept: an invitation that could not be delivered leaves no row and
 * no event, so a second attempt does not answer "already invited" to somebody
 * who never received the first.
 *
 * Ten a minute, not sixty: this is the one action that reaches an address
 * somebody else owns (§7 Phase 10).
 */
export async function inviteMemberAction(
  input: z.input<typeof inviteSchema>,
): Promise<WorkspaceActionResult<Limited<InviteFailure>>> {
  const parsed = inviteSchema.parse(input);
  const context = await requireWorkspace();

  const prepared = await writing(context, "invite", (tx) =>
    prepareInvitation(tx, context, parsed),
  );
  if (isRefused(prepared)) return refusal(prepared);

  const delivered = await deliverInvitation(
    senderFromEnvironment(),
    // The link has to work where the person opens it, not where we run.
    process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
    prepared.value,
  );
  if (isRefused(delivered)) {
    await withTenant(context, (tx) =>
      discardInvitation(tx, prepared.value.invitationId),
    );
    return refusal(delivered);
  }

  await withTenant(context, (tx) => confirmInvitation(tx, context, prepared.value));

  revalidatePath("/users");

  dispatchSoon();
  return { ok: true };
}

/**
 * Joining a workspace from its invitation. The page only shows the invitation;
 * this is the click that accepts it — and the workspace joined becomes the
 * one the browser looks at, rather than whichever membership sorts first.
 */
export async function acceptInvitationAction(token: string): Promise<void> {
  const session = await requireSession();
  const parsedToken = z.string().min(1).max(200).parse(token);

  // Accepting writes the `workspace_members` row every other policy resolves
  // through, so at this moment there is no membership to check it against. The
  // live invitation is the authorization, and the lane carries both halves of
  // it: the token's hash, and who is presenting it (migration 0009).
  const result = await withInvitation(
    await hashToken(parsedToken),
    session.userId,
    (tx) => acceptInvitation(tx, { token: parsedToken, userId: session.userId }),
  );

  if (isRefused(result)) {
    redirect(`/invitations/${encodeURIComponent(parsedToken)}?refused=${result.reason}`);
  }

  await rememberWorkspace(result.value.workspaceId);
  revalidatePath("/", "layout");
  dispatchSoon();
  redirect("/dashboard");
}

async function rememberWorkspace(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Which workspace this browser is looking at.
 *
 * Membership is checked here, before the cookie is written, so the cookie is
 * never the thing that grants access — the DAL checks it again on every
 * request, and ignores it when it names a workspace this person is not in.
 */
export async function switchWorkspaceAction(
  workspaceId: string,
): Promise<WorkspaceActionResult<"not-found">> {
  const session = await requireSession();
  const chosen = z.uuid().parse(workspaceId);

  // Whether this person is in that workspace is the question, so it cannot be
  // asked from inside it: the bootstrap lane resolves membership with no
  // workspace set (ADR 0002). A cookie is not a write worth a limit.
  const context = await withUser(session.userId, (tx) =>
    resolveTenantContext(tx, session.userId, chosen),
  );

  if (!context) return { ok: false, reason: "not-found" };

  await rememberWorkspace(context.workspaceId);
  revalidatePath("/", "layout");

  dispatchSoon();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Settings (§7 Phase 8)
 * ------------------------------------------------------------------ */

/** Whether the projects grid and the dashboard show finished projects. */
export async function setHideCompletedAction(hide: boolean): Promise<WorkspaceActionResult> {
  await requireSession();

  const jar = await cookies();
  jar.set(HIDE_COMPLETED_COOKIE, hide ? "1" : "0", {
    path: "/",
    maxAge: PREFERENCE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Deletes the current workspace, after the name was typed. The cookie that
 * pointed at it is dropped, and the dashboard repairs a personal workspace
 * on the next request.
 */
export async function deleteWorkspaceAction(
  confirmation: string,
): Promise<WorkspaceActionResult<Limited<DeleteWorkspaceFailure>>> {
  const context = await requireWorkspace();
  const typed = z.string().max(200).parse(confirmation);

  const result = await writing(context, "write", (tx) =>
    deleteWorkspace(tx, context, typed),
  );
  if (isRefused(result)) return { ok: false, reason: result.reason };

  (await cookies()).delete(WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
