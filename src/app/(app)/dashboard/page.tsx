import { FolderKanban } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { AccountMenu } from "./account-menu";

// The real panel arrives in Phase 8. What this proves today is that the DAL
// resolves a session into a tenant context, and that a workspace exists the
// moment an account does.
export default async function DashboardPage() {
  const session = await requireSession();
  const workspace = await requireWorkspace();

  return (
    <AppShell
      title="Painel"
      account={<AccountMenu name={session.name} email={session.email} />}
      panelTitle="Contexto"
      panel={<ContextPanel role={workspace.role} />}
    >
      <div className="flex max-w-3xl flex-col gap-6">
        <EmptyState
          icon={FolderKanban}
          title="Nenhum projeto ainda"
          description="Projetos, quadro e saúde chegam nas fases 5 a 8. O espaço de trabalho já existe e é seu."
        />
      </div>
    </AppShell>
  );
}

function ContextPanel({ role }: { role: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
        Espaço de trabalho
      </p>
      <div className="flex items-center justify-between gap-2 text-[13px] text-secondary">
        Seu papel
        <Badge tone="neutral">{role}</Badge>
      </div>
      <p className="text-xs text-subtle">
        Progresso, saúde e gargalos aparecem aqui quando houver projeto.
      </p>
    </div>
  );
}
