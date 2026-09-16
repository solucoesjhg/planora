import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ShellFrame } from "@/components/layout/shell-frame";
import { AccountBar } from "@/features/workspace/account-bar";
import { boardHrefFor, LAST_BOARD_COOKIE } from "@/lib/last-board";

/**
 * Every signed-in screen shares one frame: the rail and the navigation
 * drawer live here and survive navigation, so moving between screens changes
 * the centre and nothing else. Each screen still draws its own header, centre
 * and panel through AppShell, which knows it is inside this frame.
 *
 * The cookie is read once, at load: layouts do not re-render on navigation.
 * The rail keeps the link current itself from then on.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const remembered = (await cookies()).get(LAST_BOARD_COOKIE)?.value;

  return (
    <ShellFrame account={<AccountBar />} boardHref={boardHrefFor(remembered)}>
      {children}
    </ShellFrame>
  );
}
