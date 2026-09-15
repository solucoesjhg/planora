import "server-only";

import { cookies } from "next/headers";

/**
 * Per-browser preferences (DEVELOPMENT_PLAN.md §7 Phase 8). A cookie, like
 * the chosen workspace: it is a convenience, never a permission, and it
 * carries nothing the server would not show anyway.
 */
export const HIDE_COMPLETED_COOKIE = "planora-hide-completed";

/** A year: a preference is not a session. */
export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

export async function hideCompleted(): Promise<boolean> {
  return (await cookies()).get(HIDE_COMPLETED_COOKIE)?.value === "1";
}
