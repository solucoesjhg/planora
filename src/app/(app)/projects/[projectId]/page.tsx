import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { projectProgress } from "@/domain/progress";
import { Board } from "@/features/board/board";
import { NewColumnDialog } from "@/features/board/new-column-dialog";
import { HealthPanel } from "@/features/health/health-panel";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { loadBoardView, toDomainContext } from "@/server/modules/board/view";
import { evaluateProjectHealth } from "@/server/modules/health/service";
import { findProject } from "@/server/modules/projects/repository";
import { AccountBar } from "@/features/workspace/account-bar";

export default async function BoardPage({
  params,
}: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const workspace = await requireWorkspace();
  const database = getDatabase();

  const [view, project] = await Promise.all([
    loadBoardView(database, workspace, projectId),
    findProject(database, workspace, projectId),
  ]);
  if (!view || !project) notFound();

  // Reading a project is what evaluates it until Phase 9's clock exists
  // (§3.5): today's snapshot row is written here, idempotently.
  const board = toDomainContext(view);
  const health = await evaluateProjectHealth(database, workspace, project, board);
  if (health.changed) dispatchSoon();

  return (
    <ToastProvider>
      <AppShell
        title={view.project.name}
        account={<AccountBar />}
        panelTitle="Saúde"
        panel={
          <HealthPanel
            projectId={view.project.id}
            report={health.report}
            trend={health.trend}
            progress={projectProgress(board)}
            tasks={new Map(view.tasks.map((task) => [task.id, task]))}
          />
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-secondary">
              Arraste os cartões entre as colunas. Concluído recusa o que está travado.
            </p>
            <NewColumnDialog projectId={view.project.id} />
          </div>

          <Board view={view} />
        </div>
      </AppShell>
    </ToastProvider>
  );
}
