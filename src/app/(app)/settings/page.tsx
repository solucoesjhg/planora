import { Bell, Download, Zap } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { Appearance } from "@/features/settings/appearance";
import { DangerZone } from "@/features/settings/danger-zone";
import { HideCompletedSwitch } from "@/features/settings/preferences";
import { ProfileForm } from "@/features/settings/profile-form";
import { AccountBar } from "@/features/workspace/account-bar";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { can } from "@/server/auth/tenant";
import { withTenant } from "@/server/db/client";
import { listProjects } from "@/server/modules/projects/repository";
import { hideCompleted } from "@/server/modules/workspaces/preferences";
import { membershipsOf } from "@/server/modules/workspaces/repository";

/**
 * Settings (DEVELOPMENT_PLAN.md §6.2, §7 Phase 8): theme, the hide-completed
 * preference, the profile, the export, and the Danger Zone.
 */
export default async function SettingsPage() {
  const session = await requireSession();
  const workspace = await requireWorkspace();

  // Both reads share the page's one scope; the preference is a cookie and
  // stays outside it. The membership list is still every workspace this person
  // belongs to inside a tenant scope — the policy answers to the user as well
  // as to the workspace, which is what the switcher was always asking.
  const [[projects, memberships], hidingCompleted] = await Promise.all([
    withTenant(workspace, (tx) =>
      Promise.all([listProjects(tx, workspace), membershipsOf(tx, session.userId)]),
    ),
    hideCompleted(),
  ]);
  const workspaceName =
    memberships.find((membership) => membership.workspaceId === workspace.workspaceId)
      ?.workspaceName ?? "este espaço";
  const mayExport = can(workspace, "manage-project");

  return (
    <ToastProvider>
      <AppShell title="Configurações" account={<AccountBar />}>
        <div className="flex max-w-3xl flex-col gap-8">
          <Section title="Aparência" hint="Escuro é o padrão; claro para quem trabalha de dia.">
            <Appearance />
          </Section>

          <Section title="Preferências">
            <HideCompletedSwitch initial={hidingCompleted} />
          </Section>

          <Section
            title="Automações e notificações"
            hint="Regras que agem quando algo acontece, e o que chega até você."
          >
            <div className="flex flex-wrap gap-2">
              <Link
                href="/settings/automations"
                className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-[13px] text-secondary transition-colors hover:bg-card-hover hover:text-primary"
              >
                <Zap size={14} aria-hidden />
                Automações
              </Link>
              <Link
                href="/settings/notifications"
                className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-[13px] text-secondary transition-colors hover:bg-card-hover hover:text-primary"
              >
                <Bell size={14} aria-hidden />
                Notificações
              </Link>
            </div>
          </Section>

          <Section title="Perfil">
            <ProfileForm name={session.name} email={session.email} />
          </Section>

          <Section
            title="Exportar"
            hint={
              mayExport
                ? "Tudo o que este espaço de trabalho guarda: JSON para máquina, CSV para planilha (uma linha por tarefa)."
                : "Seu papel neste espaço não permite exportar."
            }
          >
            {mayExport ? (
              <div className="flex flex-wrap gap-2">
                <ExportLink format="json" />
                <ExportLink format="csv" />
              </div>
            ) : null}
          </Section>

          <Section title="Zona de perigo">
            <DangerZone
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
              workspaceName={workspaceName}
              mayDeleteProjects={can(workspace, "manage-project")}
              mayDeleteWorkspace={can(workspace, "delete-workspace")}
            />
          </Section>
        </div>
      </AppShell>
    </ToastProvider>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">{title}</h2>
        {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

function ExportLink({ format }: { format: "json" | "csv" }) {
  return (
    <a
      href={`/api/export?format=${format}`}
      download
      className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-[13px] text-secondary transition-colors hover:bg-card-hover hover:text-primary"
    >
      <Download size={14} aria-hidden />
      {format.toUpperCase()}
    </a>
  );
}
