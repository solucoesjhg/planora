"use client";

import { CalendarClock, Check, GripVertical, RotateCcw, Users } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { deadlineStatus, type DeadlineStatus } from "@/domain/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type ProjectCardData = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: "active" | "completed";
  readonly dueDate: string | null;
  readonly clientName: string | null;
  readonly openTasks: number;
  readonly totalTasks: number;
  readonly blockedTasks: number;
};

export type ProjectCardProps = {
  readonly project: ProjectCardData;
  readonly busy?: boolean;
  readonly onComplete?: (id: string) => void;
  readonly onReopen?: (id: string) => void;
};

export function ProjectCard({
  project,
  busy,
  onComplete,
  onReopen,
}: ProjectCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id, disabled: project.status === "completed" });

  const completed = project.status === "completed";
  const deadline = deadlineStatus(project.dueDate);

  return (
    <article
      ref={setNodeRef}
      data-testid="project-card"
      data-project-name={project.name}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex flex-col gap-3 rounded-card border border-line bg-card p-4 shadow-card",
        "transition-colors duration-150 hover:bg-card-hover",
        isDragging && "z-10 opacity-80",
        // Finished work goes quiet rather than disappearing.
        completed && "opacity-70 saturate-50",
      )}
    >
      <header className="flex items-start gap-2">
        {!completed ? (
          <button
            type="button"
            aria-label={`Reordenar ${project.name}`}
            className="-ml-1 cursor-grab touch-none rounded-control p-1 text-subtle hover:text-secondary"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={15} aria-hidden />
          </button>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            href={`/projects/${project.id}`}
            className="truncate text-[15px] font-medium text-primary hover:text-sienna"
          >
            {project.name}
          </Link>
          {project.clientName ? (
            <span className="flex items-center gap-1 text-xs text-subtle">
              <Users size={12} aria-hidden />
              {project.clientName}
            </span>
          ) : null}
        </div>

        <DeadlineBadge status={deadline} />
      </header>

      {project.description ? (
        <p className="line-clamp-2 text-[13px] text-secondary">{project.description}</p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          {project.openTasks} de {project.totalTasks} em aberto
        </span>

        {project.blockedTasks > 0 ? (
          <Badge tone="blocked">
            {project.blockedTasks} travada{project.blockedTasks > 1 ? "s" : ""}
          </Badge>
        ) : null}

        <span className="ml-auto flex items-center gap-1">
          {completed ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onReopen?.(project.id)}
            >
              <RotateCcw size={14} aria-hidden />
              Reabrir
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onComplete?.(project.id)}
            >
              <Check size={14} aria-hidden />
              Concluir
            </Button>
          )}
        </span>
      </footer>
    </article>
  );
}

function DeadlineBadge({ status }: { status: DeadlineStatus }) {
  if (status.kind === "none") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-subtle">
        <CalendarClock size={12} aria-hidden />
        sem prazo
      </span>
    );
  }

  if (status.kind === "due-today") return <Badge tone="medium">vence hoje</Badge>;

  if (status.kind === "late") {
    return (
      <Badge tone="high">
        {status.days} dia{status.days > 1 ? "s" : ""} de atraso
      </Badge>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
      <CalendarClock size={12} aria-hidden />
      {status.days} dia{status.days > 1 ? "s" : ""}
    </span>
  );
}
