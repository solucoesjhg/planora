import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { ToastProvider } from "@/components/ui/toast";
import { isBlocked } from "@/domain/dependencies";
import { projectProgress } from "@/domain/progress";
import { toDisplay } from "@/domain/types";
import { Board } from "@/features/board/board";
import { NewColumnDialog } from "@/features/board/new-column-dialog";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { loadBoardView, toDomainContext } from "@/server/modules/board/view";
import { AccountBar } from "@/features/workspace/account-bar";

export default async function BoardPage({
  params,
}: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const workspace = await requireWorkspace();

  const view = await loadBoardView(getDatabase(), workspace, projectId);
  if (!view) notFound();

  return (
    <ToastProvider>
      <AppShell
        title={view.project.name}
        account={<AccountBar />}
        panelTitle="Progresso"
        panel={<ProgressPanel view={view} />}
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

function ProgressPanel({
  view,
}: {
  view: NonNullable<Awaited<ReturnType<typeof loadBoardView>>>;
}) {
  const context = toDomainContext(view);
  const progress = projectProgress(context);
  const blocked = context.tasks.filter((task) => isBlocked(task, context));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-panel p-4 shadow-panel">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Progresso ajustado
        </p>
        <p className="pln-display mt-1 text-3xl text-primary">
          {toDisplay(progress.adjusted)}%
        </p>
        <p className="mt-1 text-xs text-secondary">
          Bruto {toDisplay(progress.raw)}% — a diferença é o custo do que está parado.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Travadas · {blocked.length}
        </p>

        {blocked.length === 0 ? (
          <p className="text-xs text-subtle">Nada bloqueado neste quadro.</p>
        ) : (
          blocked.slice(0, 5).map((task) => {
            const card = view.tasks.find((each) => each.id === task.id);
            return (
              <div
                key={task.id}
                className="flex items-center justify-between gap-2 border-b border-hairline pb-2 text-[13px]"
              >
                <span className="truncate text-secondary">
                  TSK-{card?.number} {card?.title}
                </span>
                <Badge tone="blocked">{card?.blocked ? "selo" : "dep."}</Badge>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-subtle">
        Saúde do projeto, gargalos e Top 2 chegam na fase 8.
      </p>
    </div>
  );
}
