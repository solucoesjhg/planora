import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Verdict } from "@/domain/health";
import { deadlineStatus } from "@/domain/projects";
import { toDisplay } from "@/domain/types";
import { SIGNAL_LABELS, VERDICT_LABELS, trendLabel } from "@/lib/strings";
import type { DashboardProject } from "@/server/modules/dashboard/view";

/**
 * The progress chart: one row per active project, the adjusted progress as
 * the bar and the raw progress as its ghost — the gap between them is what
 * blocked work costs. Beside it, the verdict, the trend and the heaviest
 * reason. Every number came from `domain/`; this file draws them.
 */

const TONES: Record<Verdict, BadgeTone> = {
  healthy: "healthy",
  attention: "attention",
  at_risk: "at_risk",
  critical: "critical",
  insufficient_data: "insufficient",
};

export function ProjectRows({
  projects,
  now = new Date(),
}: {
  projects: readonly DashboardProject[];
  now?: Date;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid="project-rows">
      <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
        Em andamento · {projects.length}
      </h2>

      {projects.length === 0 ? (
        <p className="text-xs text-subtle">
          Nenhum projeto em andamento.{" "}
          <Link href="/projects" className="text-sienna underline-offset-4 hover:underline">
            Criar um
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({ project, now }: { project: DashboardProject; now: Date }) {
  const deadline = deadlineStatus(project.dueDate, now);

  return (
    <li
      className="flex flex-col gap-3 rounded-card border border-line bg-card p-4 shadow-card"
      data-testid="dashboard-project"
      data-project-name={project.name}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/projects/${project.id}`}
            className="truncate text-[15px] font-medium text-primary hover:text-sienna"
          >
            {project.name}
          </Link>
          {project.clientName ? (
            <span className="truncate text-xs text-subtle">{project.clientName}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={TONES[project.verdict]} data-testid="dashboard-verdict">
            {VERDICT_LABELS[project.verdict]}
          </Badge>
          {project.score !== null ? (
            <span className="font-mono text-xs text-primary">{toDisplay(project.score)}</span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-secondary">Progresso ajustado</span>
          <span className="font-mono text-primary" data-testid="dashboard-progress">
            {toDisplay(project.progress.adjusted)}%
            <span className="text-subtle"> · bruto {toDisplay(project.progress.raw)}%</span>
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-card-hover">
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-sienna/30"
            style={{ width: `${toDisplay(project.progress.raw)}%` }}
          />
          <div
            role="progressbar"
            aria-valuenow={toDisplay(project.progress.adjusted)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso ajustado de ${project.name}`}
            className="absolute inset-y-0 left-0 rounded-full bg-sienna"
            style={{ width: `${toDisplay(project.progress.adjusted)}%` }}
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary">
        <span>
          <span className="font-mono text-primary">{project.openTasks}</span> abertas
        </span>
        {project.blockedTasks > 0 ? (
          <span className="text-danger">
            <span className="font-mono">{project.blockedTasks}</span>{" "}
            {project.blockedTasks === 1 ? "travada" : "travadas"}
          </span>
        ) : null}
        <span className="text-subtle">{trendLabel(project.trend)}</span>
        <DeadlineText status={deadline} />
        {project.topFinding ? (
          <span className="min-w-0 truncate text-subtle">
            <span className="font-mono text-[11px]">TSK-{project.topFinding.number}</span>{" "}
            {project.topFinding.title} · {SIGNAL_LABELS[project.topFinding.signal]}
          </span>
        ) : null}
      </footer>
    </li>
  );
}

function DeadlineText({ status }: { status: ReturnType<typeof deadlineStatus> }) {
  if (status.kind === "none") return null;
  if (status.kind === "due-today") return <Badge tone="medium">vence hoje</Badge>;
  if (status.kind === "late") {
    return (
      <Badge tone="high">
        {status.days} dia{status.days > 1 ? "s" : ""} de atraso
      </Badge>
    );
  }
  return (
    <span className="flex items-center gap-1 text-muted">
      <CalendarClock size={12} aria-hidden />
      {status.days} dia{status.days > 1 ? "s" : ""}
    </span>
  );
}
