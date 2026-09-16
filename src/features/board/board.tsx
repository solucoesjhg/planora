"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
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
import { cn } from "@/lib/cn";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { moveTaskAction } from "@/server/modules/board/actions";
import {
  toDomainContext,
  type BoardColumnView,
  type BoardTaskView,
  type BoardView,
} from "@/server/modules/board/view";
import { BoardColumn, ColumnMenu } from "./board-column";
import { NewColumnDialog } from "./new-column-dialog";
import { LAST_BOARD_COOKIE, LAST_BOARD_MAX_AGE } from "@/lib/last-board";
import { useEdgeScroll } from "./use-edge-scroll";
import { NewTask } from "./new-task";
import { TaskCard, TaskCardView } from "./task-card";

export type BoardProps = { readonly view: BoardView };

/** A phase tab is a drop target too; its id wears this so it is never a column's. */
const TAB_PREFIX = "tab:";

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
  const frame = useRef<HTMLDivElement>(null);
  useEdgeScroll(scroller, frame, { enabled: dragging === null });

  /**
   * On a phone the strip shows one column at a time and snaps between them;
   * the tabs above say which, and pick one. Which one is read from the
   * strip's own scroll position, so a swipe and a tap agree.
   */
  const [activeColumn, setActiveColumn] = useState(0);
  useEffect(() => {
    const strip = scroller.current;
    if (!strip) return;
    let raf = 0;

    const measure = () => {
      raf = 0;
      let best = 0;
      let nearest = Number.POSITIVE_INFINITY;
      Array.from(strip.children).forEach((child, index) => {
        const distance = Math.abs((child as HTMLElement).offsetLeft - strip.scrollLeft);
        if (distance < nearest) {
          nearest = distance;
          best = index;
        }
      });
      setActiveColumn(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    strip.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      strip.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  function showColumn(index: number): void {
    const strip = scroller.current;
    const child = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !child) return;
    strip.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
  }

  // Where the rail's "Quadro" goes next time: here. See lib/last-board.ts.
  useEffect(() => {
    document.cookie = `${LAST_BOARD_COOKIE}=${view.project.id}; path=/; max-age=${LAST_BOARD_MAX_AGE}; samesite=lax`;
  }, [view.project.id]);

  /**
   * Two ways to pick a card up, because a finger and a mouse mean different
   * things by "move". A mouse drags once it has travelled 5px. A finger that
   * moves at once is scrolling the strip — most of a column is cards, so
   * that has to work from on top of one — and only a finger that holds still
   * for a quarter of a second is picking up. The card allows panning
   * (`touch-manipulation`) so the browser can scroll; once a drag is on,
   * dnd-kit cancels the browser's move events itself.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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
    const toColumnId = overTask
      ? overTask.columnId
      : overId.startsWith(TAB_PREFIX)
        ? overId.slice(TAB_PREFIX.length)
        : overId;

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
      <PhaseTabs
        columns={columns}
        counts={new Map(columns.map((column) => [column.id, tasksOf(column.id).length]))}
        active={activeColumn}
        onPick={showColumn}
        projectId={view.project.id}
      />

      <div
        ref={frame}
        data-testid="board-frame"
        className="pln-scroll-frame relative flex min-h-0 flex-1 flex-col"
      >
        <div
          ref={scroller}
          data-testid="board-scroller"
          className={cn(
            "pln-scrollbar flex min-h-0 flex-1 items-start gap-(--pln-column-gap) overflow-x-auto pb-4",
            "md:snap-none md:items-stretch",
            // Snapping fights the auto-scroll that carries a card across.
            dragging === null ? "snap-x snap-mandatory" : "snap-none",
          )}
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
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingTask ? (
          <TaskCardView
            className="pln-sheet-held"
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

/**
 * The phone's way between columns: one tab per phase, the open one on its
 * colour. A tab is also a drop target — carrying a card onto "Concluído"
 * moves it there — which is how a card changes column when only one column
 * is on screen. Folded away from md up, where every column is in view.
 */
function PhaseTabs({
  columns,
  counts,
  active,
  onPick,
  projectId,
}: {
  columns: readonly BoardColumnView[];
  counts: ReadonlyMap<string, number>;
  active: number;
  onPick: (index: number) => void;
  projectId: string;
}) {
  const current = columns[active];

  // The row of tabs can be wider than the phone; the open one stays in view.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tab = list.current?.children[active] as HTMLElement | undefined;
    tab?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div className="flex items-center gap-2 border-b border-hairline md:hidden">
      <div
        ref={list}
        role="tablist"
        aria-label="Fases"
        data-testid="phase-tabs"
        className="pln-scrollbar flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
      >
        {columns.map((column, index) => (
          <PhaseTab
            key={column.id}
            column={column}
            count={counts.get(column.id) ?? 0}
            active={index === active}
            onPick={() => onPick(index)}
          />
        ))}
      </div>

      {/* The open column's own controls, since its header is folded away. */}
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <NewColumnDialog projectId={projectId} />
        {current ? (
          <ColumnMenu
            column={current}
            projectId={projectId}
            immutable={current.phase === "planning" || current.phase === "done"}
            empty={(counts.get(current.id) ?? 0) === 0}
          />
        ) : null}
      </div>
    </div>
  );
}

function PhaseTab({
  column,
  count,
  active,
  onPick,
}: {
  column: BoardColumnView;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${TAB_PREFIX}${column.id}` });

  return (
    <button
      ref={setNodeRef}
      type="button"
      role="tab"
      aria-selected={active}
      data-tab-phase={column.phase}
      onClick={onPick}
      className={cn(
        "pln-phase-tab flex h-11 shrink-0 items-center gap-1.5 rounded-t-control px-2.5 text-[12px] whitespace-nowrap",
        active ? "text-primary" : "text-secondary",
        isOver && "is-over",
      )}
    >
      <span aria-hidden className="pln-phase-tab-dot shrink-0" />
      {column.name}
      {active ? <span className="font-mono text-[11px] text-subtle">{count}</span> : null}
    </button>
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
      action={<NewTask projectId={projectId} columnId={column.id} />}
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
