"use server";

import { revalidatePath } from "next/cache";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { cookies } from "next/headers";
import { z } from "zod";
import { isRefused } from "@/lib/result";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { ROLES } from "@/server/db/schema";
import { getDatabase } from "@/server/db/client";
import { senderFromEnvironment } from "@/server/email/sender";
import { WORKSPACE_COOKIE } from "./cookie";
import { resolveTenantContext } from "./repository";
import { inviteMember, type InviteFailure } from "./service";

export type WorkspaceActionResult<Failure = string> =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Failure; readonly detail?: string };

const inviteSchema = z.object({
  email: z.email().max(200),
  role: z.enum(ROLES),
});

export async function inviteMemberAction(
  input: z.input<typeof inviteSchema>,
): Promise<WorkspaceActionResult<InviteFailure>> {
  const parsed = inviteSchema.parse(input);
  const context = await requireWorkspace();

  const result = await inviteMember(getDatabase(), context, {
    ...parsed,
    // The link has to work where the person opens it, not where we run.
    baseUrl: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
    sender: senderFromEnvironment(),
  });
  if (isRefused(result)) {
    return result.detail === undefined
      ? { ok: false, reason: result.reason }
      : { ok: false, reason: result.reason, detail: result.detail };
  }

  revalidatePath("/users");

  dispatchSoon();
  return { ok: true };
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
  const context = await resolveTenantContext(
    getDatabase(),
    session.userId,
    z.uuid().parse(workspaceId),
  );

  if (!context) return { ok: false, reason: "not-found" };

  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, context.workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");

  dispatchSoon();
  return { ok: true };
}
