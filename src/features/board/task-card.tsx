"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, ListChecks, Lock, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { forwardRef, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { deadlineStatus } from "@/domain/projects";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { BoardTaskView } from "@/server/modules/board/view";

export type TaskCardProps = {
  readonly task: BoardTaskView;
  readonly phase: string;
  readonly blocked: boolean;
  readonly bouncing?: boolean;
  /** Where the card opens. Absent on the drag overlay, which opens nothing. */
  readonly href?: string;
};

/**
 * The card, with no knowledge of dragging. The overlay renders this one: the
 * sortable wrapper below registers an id, and registering the same id twice is
 * how a board stops responding to the mouse.
 */
export const TaskCardView = forwardRef<
  HTMLElement,
  TaskCardProps & HTMLAttributes<HTMLElement> & { style?: CSSProperties }
>(function TaskCardView(
  { task, phase, blocked, bouncing, href, className, ...rest },
  ref,
) {
  void href;
  const deadline = deadlineStatus(task.dueDate);
  const checklist = task.checklist;

  return (
    <article
      ref={ref}
      data-testid="task-card"
      data-task-number={`TSK-${task.number}`}
      data-blocked={blocked ? "true" : "false"}
      className={cn(
        "relative min-h-[7.125rem] cursor-grab touch-none rounded-card border border-line",
        "bg-card p-4 shadow-card transition-colors duration-150",
        "hover:bg-card-hover active:cursor-grabbing",
        // Drop Catch: the card springs back rather than opening a dialog.
        bouncing && "motion-safe:animate-[pln-bounce_320ms_ease-out]",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-3 left-0 w-[2px] rounded-full",
          phase === "planning" && "bg-phase-planning",
          phase === "execution" && "bg-phase-execution",
          phase === "review" && "bg-phase-review",
          phase === "done" && "bg-phase-done",
        )}
      />

      <header className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] text-subtle">TSK-{task.number}</span>
        <Badge
          tone={
            task.priority === "high"
              ? "high"
              : task.priority === "low"
                ? "low"
                : "medium"
          }
        >
          {task.priority === "high"
            ? "alta"
            : task.priority === "low"
              ? "baixa"
              : "média"}
        </Badge>
      </header>

      <p className="mt-1.5 line-clamp-3 text-[14px] text-primary">{task.title}</p>

      <footer className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        {checklist.total > 0 ? (
          <span className="flex items-center gap-1">
            <ListChecks size={12} aria-hidden />
            {checklist.done}/{checklist.total}
          </span>
        ) : null}

        {task.dependsOn.length > 0 ? (
          <span className="flex items-center gap-1" title="Depende de outra tarefa">
            <Link2 size={12} aria-hidden />
            {task.dependsOn.length}
          </span>
        ) : null}

        {deadline.kind === "late" ? (
          <Badge tone="high">{deadline.days}d de atraso</Badge>
        ) : deadline.kind === "due-today" ? (
          <Badge tone="medium">hoje</Badge>
        ) : deadline.kind === "on-track" ? (
          <span className="flex items-center gap-1">
            <CalendarClock size={12} aria-hidden />
            {deadline.days}d
          </span>
        ) : null}

        {blocked ? (
          <Badge tone="blocked" className="ml-auto">
            <Lock size={11} aria-hidden />
            {task.blocked ? "bloqueada" : "dependência"}
          </Badge>
        ) : null}
      </footer>
    </article>
  );
});

/**
 * The same card, registered with dnd-kit so it can be picked up — and opened.
 *
 * A card is both a handle and a link, which the pointer has to disambiguate:
 * the press that travelled less than the sensor's activation distance was a
 * click, and anything further was a drag that has already been handled.
 */
export function TaskCard(props: TaskCardProps) {
  const router = useRouter();
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.task.id, data: { columnId: props.task.columnId } });

  function open(): void {
    if (props.href) router.push(props.href);
  }

  return (
    <TaskCardView
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40", props.href && "cursor-pointer")}
      {...attributes}
      {...listeners}
      onPointerDownCapture={(event) => {
        pressedAt.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        const start = pressedAt.current;
        if (!start) return;
        const travelled = Math.hypot(
          event.clientX - start.x,
          event.clientY - start.y,
        );
        if (travelled <= ACTIVATION_DISTANCE) open();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
      {...props}
    />
  );
}

/** The same distance the board's PointerSensor uses to decide a drag began. */
const ACTIVATION_DISTANCE = 5;
