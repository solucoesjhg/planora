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
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { TenantContext } from "@/server/auth/tenant";
import { getAuth } from "@/server/auth/config";
import { getDatabase } from "@/server/db/client";
import { resolveTenantContext } from "@/server/modules/workspaces/repository";

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
 */
export const requireWorkspace = cache(
  async (workspaceId?: string): Promise<TenantContext> => {
    const session = await requireSession();
    const context = await resolveTenantContext(
      getDatabase(),
      session.userId,
      workspaceId,
    );

    if (!context) notFound();
    return context;
  },
);

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
