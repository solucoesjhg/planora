import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { InboxList } from "@/features/notifications/inbox-list";
import { AccountBar } from "@/features/workspace/account-bar";
import { requireWorkspace } from "@/server/auth/dal";
import { withTenant } from "@/server/db/client";
import { listInbox } from "@/server/modules/notifications/repository";

/**
 * The in-app inbox (DEVELOPMENT_PLAN.md §7 Phase 9): one line per thing that
 * concerned this person, newest first.
 */
export default async function InboxPage() {
  const workspace = await requireWorkspace();
  const rows = await withTenant(workspace, (tx) => listInbox(tx, workspace, 100));

  return (
    <AppShell
      title="Caixa de entrada"
      account={<AccountBar />}
      panelTitle="Preferências"
      panel={
        <p className="text-[13px] text-secondary">
          O que chega aqui, o que também vai por e-mail, e se um resumo diário ou semanal vale mais
          que avisos soltos:{" "}
          <Link href="/settings/notifications" className="text-sienna underline-offset-4 hover:underline">
            preferências de notificação
          </Link>
          .
        </p>
      }
    >
      <div className="max-w-3xl">
        <InboxList
          now={new Date().toISOString()}
          items={rows.map((row) => ({
            id: row.id,
            title: row.title,
            body: row.body,
            href: row.href,
            read: row.readAt !== null,
            createdAt: row.createdAt.toISOString(),
          }))}
        />
      </div>
    </AppShell>
  );
}
