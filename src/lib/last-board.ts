import { isId } from "@/lib/id";

/**
 * The board this browser opened last, so the rail's "Quadro" goes straight
 * back to it — no hop through /board, no redirect — rather than to whichever
 * project sorts first. A convenience, never a permission: the board page
 * still decides whether the person may see that project.
 *
 * Written by the board itself, on the client, because a page cannot set a
 * cookie while it renders. It holds an id that is already in the address bar,
 * so it is not `httpOnly` — there is nothing in it to protect, and the rail
 * reads it in the browser to keep its link current between navigations.
 * Deleting the project clears it (projects/actions.ts).
 */
export const LAST_BOARD_COOKIE = "planora-last-board";

/** A year: a preference is not a session. */
export const LAST_BOARD_MAX_AGE = 60 * 60 * 24 * 365;

/** Where "Quadro" should go for this id, or /board when there is none. */
export function boardHrefFor(projectId: string | null | undefined): string {
  return projectId && isId(projectId) ? `/projects/${projectId}` : "/board";
}

/** The remembered board, read in the browser. Null on the server. */
export function readLastBoard(): string | null {
  if (typeof document === "undefined") return null;

  for (const pair of document.cookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === LAST_BOARD_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}
