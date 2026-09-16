import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ProjectSummary } from "@/server/modules/projects/repository";

/**
 * The right pane's last block (docs/design spec 04, MiniProjectsCard): the
 * workspace's active projects, the one on screen marked, each a link to its
 * board. Six at most — the full list has its own screen.
 */
export function MiniProjects({
  projects,
  currentId,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly currentId: string;
}) {
  const active = projects.filter((project) => project.status === "active").slice(0, 6);
  if (active.length === 0) return null;

  return (
    <section
      className="rounded-panel border border-line bg-panel p-5 shadow-panel"
      data-testid="mini-projects"
    >
      <h2 className="pln-display text-[19px] text-primary">Projetos</h2>
      <ul className="mt-3 flex flex-col gap-1">
        {active.map((project) => {
          const current = project.id === currentId;
          return (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "pln-nav-item flex min-h-11 items-center justify-between gap-3 rounded-control px-3 text-[13px] transition-colors duration-150",
                  !current && "text-secondary hover:bg-card-hover hover:text-primary",
                )}
              >
                <span className="min-w-0 truncate">{project.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-subtle">
                  {project.openTasks}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
