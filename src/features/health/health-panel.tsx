import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  type DimensionName,
  type HealthReport,
  type ProjectFinding,
  type TaskFinding,
  type Trend,
  type Verdict,
  bandOf,
} from "@/domain/health";
import type { ProjectProgress } from "@/domain/progress";
import { toDisplay } from "@/domain/types";
import { cn } from "@/lib/cn";
import {
  DIMENSION_HINTS,
  DIMENSION_LABELS,
  SIGNAL_LABELS,
  VERDICT_LABELS,
  trendLabel,
} from "@/lib/strings";

/**
 * The contextual right pane of a project (DEVELOPMENT_PLAN.md §7 Phase 8):
 * the verdict and its trend, adjusted progress, the dimensions the engine
 * could compute, the Top 2, and the rest of the bottlenecks.
 *
 * Nothing here is calculated. Every number arrived from `domain/health` or
 * `domain/progress`; this file decides where each one sits and what colour
 * it wears — and even the colour asks the domain which band a value is in.
 */

export type TaskLabel = { readonly number: number; readonly title: string };

export type HealthPanelProps = {
  readonly projectId: string;
  readonly report: HealthReport;
  readonly trend: Trend;
  readonly progress: ProjectProgress;
  /** The cards the findings name, for their numbers and titles. */
  readonly tasks: ReadonlyMap<string, TaskLabel>;
};

export const VERDICT_TONES: Record<Verdict, BadgeTone> = {
  healthy: "healthy",
  attention: "attention",
  at_risk: "at_risk",
  critical: "critical",
  insufficient_data: "insufficient",
};

/** The order the plan lists them in, which is also the order of their weights. */
const DIMENSION_ORDER: readonly DimensionName[] = [
  "flow",
  "pace",
  "punctuality",
  "freshness",
  "momentum",
];

const BAR_TONES: Record<Exclude<Verdict, "insufficient_data">, string> = {
  healthy: "bg-success",
  attention: "bg-warning",
  at_risk: "bg-danger",
  critical: "bg-danger",
};

export function HealthPanel({ projectId, report, trend, progress, tasks }: HealthPanelProps) {
  const computed = DIMENSION_ORDER.filter((name) => report.dimensions[name] !== null);
  const projectFindings = report.findings.filter(
    (finding): finding is ProjectFinding => finding.scope === "project",
  );
  const rest = report.bottlenecks
    .filter(
      (finding) =>
        !report.topTwo.some(
          (top) => top.taskId === finding.taskId && top.signal === finding.signal,
        ),
    )
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5" data-testid="health-panel">
      <section className="rounded-panel border border-line bg-panel p-5 shadow-panel">
        <h2 className="pln-display text-[19px] text-primary">Saúde</h2>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Badge tone={VERDICT_TONES[report.verdict]} data-testid="health-verdict">
            {VERDICT_LABELS[report.verdict]}
          </Badge>
          {report.score !== null ? (
            <span className="pln-display text-3xl text-primary" data-testid="health-score">
              {toDisplay(report.score)}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-secondary" data-testid="health-trend">
          {report.score === null
            ? "Um projeto novo, ou com menos de três tarefas abertas, ainda não tem veredito."
            : trendLabel(trend)}
        </p>
      </section>

      <section className="rounded-panel border border-line bg-panel p-5 shadow-panel">
        <h2 className="pln-display text-[19px] text-primary">Progresso ajustado</h2>
        {/*
          Two segments on the ring, both numbers the domain already gave:
          what is done, then the slice progress lost to what is stalled —
          the gap between raw and adjusted — and the track for the rest.
        */}
        <div
          className="pln-donut mx-auto mt-4"
          role="img"
          aria-label={`Progresso ajustado ${toDisplay(progress.adjusted)}%, bruto ${toDisplay(progress.raw)}%`}
          style={
            {
              "--pln-donut-done": `${toDisplay(progress.adjusted)}%`,
              "--pln-donut-raw": `${toDisplay(Math.max(progress.raw, progress.adjusted))}%`,
            } as React.CSSProperties
          }
        >
          <div className="pln-donut-well">
            <span
              className="pln-display text-[34px] leading-none text-primary"
              data-testid="progress-adjusted"
            >
              {toDisplay(progress.adjusted)}%
            </span>
          </div>
        </div>
        <p className="mt-4 text-xs text-secondary">
          Bruto {toDisplay(progress.raw)}% — a diferença é o custo do que está parado.
        </p>
      </section>

      {computed.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            Dimensões · {computed.length}
          </p>
          <ul className="flex flex-col gap-2.5">
            {computed.map((name) => {
              const value = report.dimensions[name]!;
              return (
                <li
                  key={name}
                  data-testid="health-dimension"
                  data-dimension={name}
                  title={DIMENSION_HINTS[name]}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-secondary">{DIMENSION_LABELS[name]}</span>
                    <span className="font-mono text-xs text-primary">{toDisplay(value)}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-card-hover">
                    <div
                      className={cn("h-full rounded-full", BAR_TONES[bandOf(value)])}
                      style={{ width: `${toDisplay(value)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {report.dimensions.pace === null ? (
            <p className="text-xs text-subtle">
              Sem datas no projeto, o ritmo não é medido — quatro dimensões, não cinco.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-panel border border-line bg-panel p-5 shadow-panel">
        <h2 className="pln-display text-[19px] text-primary">Tarefas principais</h2>

      {report.topTwo.length > 0 ? (
        <section className="mt-3 flex flex-col gap-2" data-testid="health-top-two">
          <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">Top 2</p>
          <ul className="flex flex-col">
            {report.topTwo.map((finding) => (
              <FindingLine
                key={`${finding.taskId}:${finding.signal}`}
                projectId={projectId}
                finding={finding}
                task={tasks.get(finding.taskId)}
                emphasis
              />
            ))}
          </ul>
        </section>
      ) : null}

      {projectFindings.length > 0 ? (
        <section className="mt-3 flex flex-col gap-2">
          <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">No projeto</p>
          <ul className="flex flex-col gap-1">
            {projectFindings.map((finding) => (
              <li key={finding.signal} className="text-[13px] text-secondary">
                {SIGNAL_LABELS[finding.signal]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-3 flex flex-col gap-2" data-testid="health-bottlenecks">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Gargalos · {report.bottlenecks.length}
        </p>
        {report.bottlenecks.length === 0 ? (
          <p className="text-xs text-subtle">Nenhuma tarefa carrega sinal neste quadro.</p>
        ) : rest.length === 0 ? (
          <p className="text-xs text-subtle">Só os dois acima.</p>
        ) : (
          <ul className="flex flex-col">
            {rest.map((finding) => (
              <FindingLine
                key={`${finding.taskId}:${finding.signal}`}
                projectId={projectId}
                finding={finding}
                task={tasks.get(finding.taskId)}
              />
            ))}
          </ul>
        )}
      </section>
      </section>
    </div>
  );
}

function FindingLine({
  projectId,
  finding,
  task,
  emphasis = false,
}: {
  projectId: string;
  finding: TaskFinding;
  task: TaskLabel | undefined;
  emphasis?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-hairline py-2 text-[13px] last:border-b-0 last:pb-0">
      <Link
        href={`/projects/${projectId}/tasks/${finding.taskId}`}
        className={cn(
          "min-w-0 truncate hover:text-sienna",
          emphasis ? "text-primary" : "text-secondary",
        )}
      >
        <span className="font-mono text-[11px] text-subtle">TSK-{task?.number ?? "?"}</span>{" "}
        {task?.title ?? "Tarefa"}
      </Link>
      <span className="flex shrink-0 items-center gap-1.5">
        <Badge tone={finding.signal === "blocked" ? "blocked" : "neutral"}>
          {SIGNAL_LABELS[finding.signal]}
        </Badge>
        <span className="font-mono text-[11px] text-subtle" title="peso do sinal">
          {finding.weight.toLocaleString("pt-BR")}
        </span>
      </span>
    </li>
  );
}
