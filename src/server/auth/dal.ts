/**
 * The Data Access Layer (DEVELOPMENT_PLAN.md §2.4, §2.5).
 *
 * Authorization lives as close to the data as possible — the framework's own
 * guidance — and `proxy.ts` is only an optimistic redirect. Everything here is
 * `server-only` and memoized per render, so a page that asks three times pays
 * for one query.
 */

import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { TenantContext } from "@/server/auth/tenant";
import { getAuth } from "@/server/auth/config";
import { getSystemDatabase, withUser } from "@/server/db/client";
import { WORKSPACE_COOKIE } from "@/server/modules/workspaces/cookie";
import {
  ensurePersonalWorkspace,
  resolveTenantContext,
} from "@/server/modules/workspaces/repository";

export type Session = {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
};

/** The signed-in user, or a redirect to the login page. */
export const requireSession = cache(async (): Promise<Session> => {
  // `headers()` first: reading the request is what takes this route out of the
  // prerender, and nothing should touch the database before that happens.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
});

/**
 * The tenant context for this request. A workspace the user is not a member of
 * is `notFound()`, never "forbidden": a stranger should not learn that the
 * workspace exists.
 *
 * With no id asked for, the browser's chosen workspace wins — a cookie the
 * switcher writes. The cookie is a preference, never a permission: membership
 * is resolved from the database on every request, and a cookie naming a
 * workspace this person is not in is ignored rather than obeyed, so being
 * removed from a workspace cannot lock somebody out of their own.
 */
export const requireWorkspace = cache(
  async (workspaceId?: string): Promise<TenantContext> => {
    const session = await requireSession();

    const chosen = workspaceId ?? (await chosenWorkspace());
    // The bootstrap lane (ADR 0002): which workspace this is cannot be part of
    // the question, because answering it is how we find out. One scope covers
    // both attempts.
    const context = await withUser(session.userId, async (tx) => {
      return (
        (await resolveTenantContext(tx, session.userId, chosen)) ??
        // The cookie named somewhere they no longer belong.
        (chosen && !workspaceId
          ? await resolveTenantContext(tx, session.userId)
          : null)
      );
    });
    if (context) return context;

    // Asking for a specific workspace and not being a member of it is a 404,
    // always. Having no workspace at all is a different thing: the signup hook
    // runs outside the account's transaction, so it can fail after the account
    // exists. Repair it here rather than locking someone out of their own
    // account.
    if (workspaceId) notFound();

    // The system lane, and the one place it is unavoidable: this writes a
    // workspace and a membership for somebody who belongs to nothing yet, so
    // there is no membership for a policy to check it against (ADR 0002).
    await ensurePersonalWorkspace(getSystemDatabase(), {
      id: session.userId,
      name: session.name,
      email: session.email,
    });

    const repaired = await withUser(session.userId, (tx) =>
      resolveTenantContext(tx, session.userId),
    );
    if (!repaired) notFound();
    return repaired;
  },
);

/** The workspace this browser last chose, if it chose one. */
async function chosenWorkspace(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(WORKSPACE_COOKIE)?.value;
}

/** For pages that only need to know whether anybody is signed in. */
export const currentSession = cache(async (): Promise<Session | null> => {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
});
