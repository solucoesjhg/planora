import { AccountMenu } from "@/app/(app)/dashboard/account-menu";
import { InboxBell } from "@/features/notifications/inbox-bell";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { withUser } from "@/server/db/client";
import { membershipsOf } from "@/server/modules/workspaces/repository";

/**
 * The account corner, assembled once.
 *
 * Every screen was passing the session by hand and none of them knew about the
 * other workspaces the person belongs to; the switcher needs that list, and it
 * should not be seven copies of the same three lines.
 */
export async function AccountBar() {
  const session = await requireSession();
  const current = await requireWorkspace();
  // Which workspaces somebody may switch to is a question asked of the person,
  // not of a workspace, so it goes down the bootstrap lane rather than the
  // tenant one (ADR 0002) — the current workspace above is what the bell and
  // the check mark need, not what bounds this list.
  const memberships = await withUser(session.userId, (tx) =>
    membershipsOf(tx, session.userId),
  );

  return (
    <div className="flex items-center gap-1">
      <span className="pln-account-extra">
        <InboxBell context={current} />
      </span>
      <AccountMenu
        name={session.name}
        email={session.email}
        workspaces={memberships.map((membership) => ({
          id: membership.workspaceId,
          name: membership.workspaceName,
          current: membership.workspaceId === current.workspaceId,
        }))}
      />
    </div>
  );
}
