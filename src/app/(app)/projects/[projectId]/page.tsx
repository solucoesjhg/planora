import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { projectProgress } from "@/domain/progress";
import { Board } from "@/features/board/board";
import { NewColumnDialog } from "@/features/board/new-column-dialog";
import { HealthPanel } from "@/features/health/health-panel";
import { HealthSummary } from "@/features/health/health-summary";
import { requireWorkspace } from "@/server/auth/dal";
import { withTenant } from "@/server/db/client";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { loadBoardView, toDomainContext } from "@/server/modules/board/view";
import { evaluateProjectHealth } from "@/server/modules/health/service";
import { findProject, listProjects } from "@/server/modules/projects/repository";
import { MiniProjects } from "@/features/projects/mini-projects";
import { AccountBar } from "@/features/workspace/account-bar";

export default async function BoardPage({
  params,
}: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const workspace = await requireWorkspace();

  // One scope for the three reads and the evaluation they feed, not one each
  // (ADR 0002): the queries still go out together, and the snapshot is written
  // from what they returned. A board that is not there comes back as null so
  // that `notFound()` throws outside the scope, not as a rollback.
  const loaded = await withTenant(workspace, async (tx) => {
    const [view, project, projects] = await Promise.all([
      loadBoardView(tx, workspace, projectId),
      findProject(tx, workspace, projectId),
      listProjects(tx, workspace),
    ]);
    if (!view || !project) return null;

    // Reading a project is what evaluates it until Phase 9's clock exists
    // (§3.5): today's snapshot row is written here, idempotently.
    const board = toDomainContext(view);
    const health = await evaluateProjectHealth(tx, workspace, project, board);
    return { view, projects, board, health };
  });
  if (!loaded) notFound();

  const { view, projects, board, health } = loaded;
  if (health.changed) dispatchSoon();

  return (
    <ToastProvider>
      <AppShell
        title={view.project.name}
        eyebrow="Projeto"
        account={<AccountBar />}
        panelTitle="Saúde"
        panelSummary={
          <HealthSummary report={health.report} progress={projectProgress(board)} />
        }
        panel={
          <>
            <HealthPanel
              projectId={view.project.id}
              report={health.report}
              trend={health.trend}
              progress={projectProgress(board)}
              tasks={new Map(view.tasks.map((task) => [task.id, task]))}
            />
            <MiniProjects projects={projects} currentId={view.project.id} />
          </>
        }
      >
        <div className="flex min-h-0 flex-col gap-4 md:h-full">
          <div className="hidden items-center justify-between gap-3 md:flex">
            <p className="hidden text-[13px] text-secondary md:block">
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
