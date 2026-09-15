import { PHASES, type Phase } from "@/domain/types";
import { cn } from "@/lib/cn";
import { PHASE_LABELS } from "@/lib/strings";

/**
 * Where the work is: every live task of every active project, by the phase of
 * its column. One stacked bar and a legend — a chart library would be a
 * dependency for four rectangles (§5.2).
 */

const FILL: Record<Phase, string> = {
  planning: "bg-phase-planning",
  execution: "bg-phase-execution",
  review: "bg-phase-review",
  done: "bg-phase-done",
};

export function DistributionChart({ counts }: { counts: Record<Phase, number> }) {
  const total = PHASES.reduce((sum, phase) => sum + counts[phase], 0);

  return (
    <section className="flex flex-col gap-3" data-testid="distribution-chart">
      <header className="flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Distribuição · {total} {total === 1 ? "tarefa" : "tarefas"}
        </h2>
      </header>

      {total === 0 ? (
        <p className="text-xs text-subtle">Nenhuma tarefa nos projetos em andamento.</p>
      ) : (
        <>
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-card-hover"
            role="img"
            aria-label={PHASES.map((phase) => `${PHASE_LABELS[phase]}: ${counts[phase]}`).join(", ")}
          >
            {PHASES.map((phase) =>
              counts[phase] > 0 ? (
                <div
                  key={phase}
                  className={cn("h-full", FILL[phase])}
                  style={{ width: `${(100 * counts[phase]) / total}%` }}
                  title={`${PHASE_LABELS[phase]} · ${counts[phase]}`}
                />
              ) : null,
            )}
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {PHASES.map((phase) => (
              <li
                key={phase}
                className="flex items-center gap-1.5 text-xs text-secondary"
                data-testid="distribution-phase"
                data-phase={phase}
              >
                <span aria-hidden className={cn("size-2 rounded-full", FILL[phase])} />
                {PHASE_LABELS[phase]}
                <span className="font-mono text-primary">{counts[phase]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
