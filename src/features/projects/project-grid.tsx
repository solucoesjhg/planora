"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { FolderKanban } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import {
  completeProjectAction,
  moveProjectAction,
  reopenProjectAction,
  type ActionResult,
} from "@/server/modules/projects/actions";
import { ProjectCard, type ProjectCardData } from "./project-card";

export type ProjectGridProps = {
  readonly projects: readonly ProjectCardData[];
};

const REFUSALS: Record<string, { title: string; description: string }> = {
  "blocked-tasks": {
    title: "Ainda há trabalho travado",
    description:
      "Destrave as tarefas bloqueadas antes de concluir — é o que mantém o progresso confiável.",
  },
  forbidden: {
    title: "Sem permissão",
    description: "Seu papel neste espaço não permite gerenciar projetos.",
  },
  "not-found": {
    title: "Projeto não encontrado",
    description: "Ele pode ter sido removido em outra aba.",
  },
};

export function ProjectGrid({ projects }: ProjectGridProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState(projects);
  const [confirming, setConfirming] = useState<{
    projectId: string;
    openTasks: number;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // The server is the source of order; this only keeps the drag from snapping
  // back before the action returns.
  const current = pending ? order : projects;
  const active = current.filter((project) => project.status === "active");
  const completed = current.filter((project) => project.status === "completed");

  function announce(result: ActionResult, projectId: string) {
    if (result.ok) return;

    // Unfinished work is a question, not a failure: ask it in a dialog the
    // person can answer, and carry the answer back as an acknowledgement.
    if (result.reason === "open-work") {
      setConfirming({ projectId, openTasks: Number(result.detail ?? 0) });
      return;
    }

    const message = REFUSALS[result.reason] ?? {
      title: "Não foi possível concluir",
      description: "Tente de novo em instantes.",
    };
    toast.add({ title: message.title, description: message.description });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;

    const from = active.findIndex((project) => project.id === dragged.id);
    const to = active.findIndex((project) => project.id === over.id);
    if (from < 0 || to < 0) return;

    const reordered = arrayMove([...active], from, to);
    setOrder([...reordered, ...completed]);

    const before = reordered[to + 1]?.id ?? null;
    const after = reordered[to - 1]?.id ?? null;

    startTransition(async () => {
      await moveProjectAction({
        projectId: String(dragged.id),
        afterId: after,
        beforeId: before,
      });
    });
  }

  if (current.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="Nenhum projeto ainda"
        description="Crie o primeiro para ver progresso, saúde e gargalos aparecerem aqui."
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
          Em andamento · {active.length}
        </h2>

        {active.length === 0 ? (
          <p className="text-[13px] text-secondary">
            Tudo concluído. Crie um projeto novo quando quiser.
          </p>
        ) : (
          <DndContext
            // dnd-kit names its screen-reader region from an internal counter,
            // which differs between the server's render and the browser's. A
            // fixed id is the same on both sides.
            id="project-grid"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={active.map((project) => project.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {active.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    busy={pending}
                    onComplete={(id) =>
                      startTransition(async () => {
                        announce(await completeProjectAction({ projectId: id }), id);
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent
          title="Concluir mesmo assim?"
          description={
            confirming
              ? `Este projeto ainda tem ${confirming.openTasks} tarefa(s) fora da coluna Concluído.`
              : undefined
          }
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => {
                  const target = confirming?.projectId;
                  setConfirming(null);
                  if (!target) return;

                  startTransition(async () => {
                    announce(
                      await completeProjectAction({
                        projectId: target,
                        ack: "open-work",
                      }),
                      target,
                    );
                  });
                }}
              >
                Concluir
              </Button>
            </>
          }
        >
          As tarefas continuam como estão — nada é marcado como feito por você.
        </DialogContent>
      </Dialog>

      {completed.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
            Concluídos · {completed.length}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {completed.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={pending}
                onReopen={(id) =>
                  startTransition(async () => {
                    announce(await reopenProjectAction({ projectId: id }), id);
                  })
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
