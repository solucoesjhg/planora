import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { PreferencesForm } from "@/features/notifications/preferences-form";
import { AccountBar } from "@/features/workspace/account-bar";
import type { NotifiableType } from "@/lib/notifications";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { preferencesOf } from "@/server/modules/notifications/repository";

/** Which events reach this person, by which channel, and how often a digest goes. */
export default async function NotificationSettingsPage() {
  const workspace = await requireWorkspace();
  const saved = (await preferencesOf(getDatabase(), workspace.workspaceId, [workspace.userId])).get(
    workspace.userId,
  );

  return (
    <ToastProvider>
      <AppShell
        title="Notificações"
        account={<AccountBar />}
        panelTitle="Como funciona"
        panel={
          <div className="flex flex-col gap-3 text-[13px] text-secondary">
            <p>
              Nada do que você mesmo fez volta para você. O que os outros fazem nas suas tarefas, e o
              que o relógio nota, chega pela caixa de entrada — e por e-mail quando você marcar.
            </p>
            <p>Um resumo junta o que ficou sem ler numa mensagem só, por dia ou por semana.</p>
            <Link href="/settings" className="text-sienna underline-offset-4 hover:underline">
              Voltar às configurações
            </Link>
          </div>
        }
      >
        <div className="max-w-3xl">
          <PreferencesForm
            initial={{
              channels: (saved?.channels ?? {}) as Partial<
                Record<NotifiableType, { inApp?: boolean; email?: boolean }>
              >,
              digest: saved?.digest ?? "none",
            }}
          />
        </div>
      </AppShell>
    </ToastProvider>
  );
}
