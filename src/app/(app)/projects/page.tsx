import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { NewProjectDialog } from "@/features/projects/new-project-dialog";
import { ProjectGrid } from "@/features/projects/project-grid";
import { requireWorkspace } from "@/server/auth/dal";
import { withTenant } from "@/server/db/client";
import { listProjects } from "@/server/modules/projects/repository";
import { hideCompleted } from "@/server/modules/workspaces/preferences";
import { AccountBar } from "@/features/workspace/account-bar";

export default async function ProjectsPage() {
  const workspace = await requireWorkspace();
  const [projects, hidingCompleted] = await Promise.all([
    withTenant(workspace, (tx) => listProjects(tx, workspace)),
    // A cookie, not a query: it stays outside the scope rather than holding a
    // pooled backend open for the time it takes to read one.
    hideCompleted(),
  ]);

  const active = projects.filter((project) => project.status === "active");
  const blocked = projects.reduce(
    (total, project) => total + project.blockedTasks,
    0,
  );

  return (
    <ToastProvider>
      <AppShell
        title="Projetos"
        account={<AccountBar />}
        panelTitle="Resumo"
        panel={
          <Summary
            active={active.length}
            completed={projects.length - active.length}
            blocked={blocked}
          />
        }
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-secondary">
              Arraste para reordenar. Concluir exige que nada esteja travado.
            </p>
            <NewProjectDialog />
          </div>

          <ProjectGrid
            projects={projects
              .filter((project) => !hidingCompleted || project.status === "active")
              .map((project) => ({
              id: project.id,
              name: project.name,
              description: project.description,
              status: project.status,
              dueDate: project.dueDate,
              clientName: project.clientName,
              openTasks: project.openTasks,
              totalTasks: project.totalTasks,
                blockedTasks: project.blockedTasks,
              }))}
          />
        </div>
      </AppShell>
    </ToastProvider>
  );
}

function Summary({
  active,
  completed,
  blocked,
}: {
  active: number;
  completed: number;
  blocked: number;
}) {
  return (
    <dl className="flex flex-col gap-3 text-[13px]">
      <Line label="Em andamento" value={active} />
      <Line label="Concluídos" value={completed} />
      <Line label="Tarefas travadas" value={blocked} tone={blocked > 0 ? "warn" : undefined} />
      <p className="mt-2 text-xs text-subtle">
        Progresso e saúde de cada projeto estão no Painel.
      </p>
    </dl>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-hairline pb-2">
      <dt className="text-secondary">{label}</dt>
      <dd
        className={
          tone === "warn"
            ? "pln-display text-xl text-danger"
            : "pln-display text-xl text-primary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
