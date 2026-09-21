import { Bell } from "lucide-react";
import Link from "next/link";
import type { TenantContext } from "@/server/auth/tenant";
import { withTenant } from "@/server/db/client";
import { unreadCount } from "@/server/modules/notifications/repository";

/** The way into the inbox, with how much is waiting there. */
export async function InboxBell({ context }: { context: TenantContext }) {
  // A scope of its own: this renders inside a page that already had one, and
  // a transaction is not a value `cache()` can hold across a render.
  const unread = await withTenant(context, (tx) => unreadCount(tx, context));

  return (
    <Link
      href="/inbox"
      aria-label={unread > 0 ? `Caixa de entrada, ${unread} sem ler` : "Caixa de entrada"}
      data-testid="inbox-bell"
      className="relative rounded-control p-2 text-muted transition-colors hover:bg-card-hover hover:text-primary"
    >
      <Bell size={16} aria-hidden />
      {unread > 0 ? (
        <span
          data-testid="inbox-unread"
          className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-sienna px-1 text-[10px] font-medium text-on-accent"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
