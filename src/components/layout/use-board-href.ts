"use client";

import { useSyncExternalStore } from "react";
import { boardHrefFor, readLastBoard } from "@/lib/last-board";

/**
 * Where "Quadro" goes, kept current: the cookie the board writes is an
 * external store, read on every render — the rail and the tab bar re-render
 * with the pathname — with the server's value during hydration so both
 * sides agree. A layout does not re-render on navigation, so its prop alone
 * would go stale once a second board opened.
 */
export function useBoardHref(initial: string = "/board"): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => {
      const remembered = boardHrefFor(readLastBoard());
      return remembered === "/board" ? initial : remembered;
    },
    () => initial,
  );
}

/** Cookies fire no event; the readers re-read on their own re-renders. */
function subscribeToNothing(): () => void {
  return () => {};
}
