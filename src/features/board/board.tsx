"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { canMoveTask, keyBetween, type MoveRefusal } from "@/domain/kanban";
import { isBlocked } from "@/domain/dependencies";
import { byBoardOrder } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { moveTaskAction } from "@/server/modules/board/actions";
import {
  toDomainContext,
  type BoardColumnView,
  type BoardTaskView,
  type BoardView,
} from "@/server/modules/board/view";
import { BoardColumn } from "./board-column";
import { NewTask } from "./new-task";
import { TaskCard, TaskCardView } from "./task-card";

export type BoardProps = { readonly view: BoardView };

type Move = {
  readonly taskId: string;
  readonly toColumnId: string;
  readonly position: string;
};

const REFUSALS: Record<MoveRefusal, { title: string; description: string }> = {
  blocked: {
    title: "Tarefa travada",
    description: "Destrave antes de concluir — o motivo está no cartão.",
  },
  dependencies: {
    title: "Depende de outra tarefa",
    description: "A tarefa de que ela depende ainda não foi concluída.",
  },
  checklist: {
    title: "Checklist em aberto",
    description: "Ainda há itens não marcados nesta tarefa.",
  },
};

export function Board({ view }: BoardProps) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [tasks, applyMove] = useOptimistic(view.tasks, moveReducer);
  const [dragging, setDragging] = useState<string | null>(null);
  const [bouncing, setBouncing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    taskId: string;
    toColumnId: string;
    afterTaskId: string | null;
    beforeTaskId: string | null;
  } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Where this project's board was left, per project, for this tab only.
  const storageKey = `planora-board-scroll:${view.project.id}`;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) element.scrollLeft = Number(saved);
    } catch {
      // A tab with storage blocked simply starts at the left.
    }

    const remember = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(element.scrollLeft));
      } catch {
        // Ignored for the same reason.
      }
    };

    element.addEventListener("scroll", remember, { passive: true });
    return () => element.removeEventListener("scroll", remember);
  }, [storageKey]);

  const columns = [...view.columns].sort(byBoardOrder);
  const context = toDomainContext({ columns: view.columns, tasks });
  const tasksOf = (columnId: string) =>
    tasks
      .filter((task) => task.columnId === columnId)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));

  function onDragStart(event: DragStartEvent) {
    setDragging(String(event.active.id));
    setBouncing(null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);

    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const task = tasks.find((each) => each.id === taskId);
    if (!task) return;

    const overId = String(over.id);
    const overTask = tasks.find((each) => each.id === overId);
    const toColumnId = overTask ? overTask.columnId : overId;

    const from = context.columns.find((column) => column.id === task.columnId);
    const to = context.columns.find((column) => column.id === toColumnId);
    const domainTask = context.tasks.find((each) => each.id === taskId);
    if (!from || !to || !domainTask) return;

    const target = tasksOf(toColumnId).filter((each) => each.id !== taskId);
    const overIndex = overTask
      ? target.findIndex((each) => each.id === overId)
      : target.length;
    const index = overIndex < 0 ? target.length : overIndex;

    const afterTaskId = target[index - 1]?.id ?? null;
    const beforeTaskId = target[index]?.id ?? null;

    const decision = canMoveTask({ task: domainTask, from, to, context });

    if (decision.kind === "refused") {
      if (decision.reason === "checklist") {
        setConfirming({ taskId, toColumnId, afterTaskId, beforeTaskId });
        return;
      }

      /**
       * Drop Catch: the card springs back and a toast names the reason. No
       * request is made — the board asked the same function the server would
       * have asked, and got the same answer.
       */
      setBouncing(taskId);
      const message = REFUSALS[decision.reason];
      toast.add({ title: message.title, description: message.description });
      return;
    }

    commit({ taskId, toColumnId, afterTaskId, beforeTaskId });
  }

  function commit(move: {
    taskId: string;
    toColumnId: string;
    afterTaskId: string | null;
    beforeTaskId: string | null;
    ack?: "checklist";
  }) {
    const neighbours = tasksOf(move.toColumnId).filter(
      (each) => each.id !== move.taskId,
    );
    const lower = move.afterTaskId
      ? (neighbours.find((each) => each.id === move.afterTaskId)?.position ?? null)
      : null;
    const upper = move.beforeTaskId
      ? (neighbours.find((each) => each.id === move.beforeTaskId)?.position ?? null)
      : null;

    // The same key the server will compute, so the optimistic order is the one
    // that comes back.
    const position = keyBetween(
      lower,
      upper ?? (lower === null && neighbours.length > 0 ? neighbours[0]!.position : null),
    );

    startTransition(async () => {
      applyMove({ taskId: move.taskId, toColumnId: move.toColumnId, position });

      const result = await moveTaskAction({
        projectId: view.project.id,
        taskId: move.taskId,
        toColumnId: move.toColumnId,
        afterTaskId: move.afterTaskId,
        beforeTaskId: move.beforeTaskId,
        ...(move.ack ? { ack: move.ack } : {}),
      });

      if (!result.ok) {
        const known = REFUSALS[result.reason as MoveRefusal];
        toast.add({
          title: known?.title ?? "Movimento recusado",
          description: known?.description ?? "Recarregue a página e tente de novo.",
        });
      }
    });
  }

  const draggingTask = dragging
    ? tasks.find((task) => task.id === dragging)
    : undefined;

  return (
    <DndContext
      // Fixed, so the screen-reader region it names matches between the
      // server's render and the browser's.
      id="board"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        ref={scroller}
        data-testid="board-scroller"
        className="flex min-h-0 flex-1 gap-[--pln-column-gap] overflow-x-auto pb-4"
      >
        {columns.map((column) => (
          <DroppableColumn
            key={column.id}
            column={column}
            projectId={view.project.id}
            tasks={tasksOf(column.id)}
            blockedIds={new Set(
              context.tasks
                .filter((task) => isBlocked(task, context))
                .map((task) => task.id),
            )}
            bouncing={bouncing}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingTask ? (
          <TaskCardView
            task={draggingTask}
            phase={
              columns.find((column) => column.id === draggingTask.columnId)?.phase ??
              "planning"
            }
            blocked={false}
          />
        ) : null}
      </DragOverlay>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent
          title="Concluir com checklist aberto?"
          description="A tarefa vai para Concluído e o histórico registra que foi forçada. Os itens abertos continuam abertos."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const move = confirming;
                  setConfirming(null);
                  if (move) commit({ ...move, ack: "checklist" });
                }}
              >
                Concluir mesmo assim
              </Button>
            </>
          }
        />
      </Dialog>
    </DndContext>
  );
}

function DroppableColumn({
  column,
  projectId,
  tasks,
  blockedIds,
  bouncing,
}: {
  column: BoardColumnView;
  projectId: string;
  tasks: readonly BoardTaskView[];
  blockedIds: ReadonlySet<string>;
  bouncing: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <BoardColumn
      ref={setNodeRef}
      column={column}
      projectId={projectId}
      count={tasks.length}
      isOver={isOver}
      footer={<NewTask projectId={projectId} columnId={column.id} />}
    >
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            phase={column.phase}
            blocked={blockedIds.has(task.id)}
            bouncing={bouncing === task.id}
            href={`/projects/${projectId}/tasks/${task.id}`}
          />
        ))}
      </SortableContext>
    </BoardColumn>
  );
}

function moveReducer(
  tasks: readonly BoardTaskView[],
  move: Move,
): readonly BoardTaskView[] {
  return tasks.map((task) =>
    task.id === move.taskId
      ? { ...task, columnId: move.toColumnId, position: move.position }
      : task,
  );
}
