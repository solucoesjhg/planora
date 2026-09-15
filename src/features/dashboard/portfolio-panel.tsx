import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { type Verdict, VERDICTS } from "@/domain/health";
import { toDisplay } from "@/domain/types";
import { ROLE_LABELS, SIGNAL_LABELS, VERDICT_LABELS, trendLabel } from "@/lib/strings";
import type { Dashboard, DashboardProject } from "@/server/modules/dashboard/view";

/**
 * The dashboard's contextual pane: how many projects sit in each verdict, and
 * the ones that need somebody first — worst score at the top, each with the
 * heaviest reason the engine found.
 */

const TONES: Record<Verdict, BadgeTone> = {
  healthy: "healthy",
  attention: "attention",
  at_risk: "at_risk",
  critical: "critical",
  insufficient_data: "insufficient",
};

export function PortfolioPanel({ dashboard, role }: { dashboard: Dashboard; role: string }) {
  const scored = dashboard.projects
    .filter((project) => project.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const needing = scored.filter((project) => project.verdict !== "healthy").slice(0, 4);

  return (
    <div className="flex flex-col gap-5" data-testid="portfolio-panel">
      <section className="flex flex-col gap-2">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">Espaço de trabalho</p>
        <div className="flex items-center justify-between gap-2 text-[13px] text-secondary">
          Seu papel
          <Badge tone="neutral">{ROLE_LABELS[role] ?? role}</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">Portfólio</p>
        <dl className="flex flex-col gap-1.5 text-[13px]">
          {VERDICTS.map((verdict) =>
            dashboard.verdicts[verdict] > 0 ? (
              <div key={verdict} className="flex items-center justify-between gap-2">
                <dt>
                  <Badge tone={TONES[verdict]}>{VERDICT_LABELS[verdict]}</Badge>
                </dt>
                <dd className="font-mono text-primary" data-testid={`verdict-count-${verdict}`}>
                  {dashboard.verdicts[verdict]}
                </dd>
              </div>
            ) : null,
          )}
          {dashboard.projects.length === 0 ? (
            <p className="text-xs text-subtle">Nenhum projeto em andamento.</p>
          ) : null}
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">Atenção primeiro</p>
        {needing.length === 0 ? (
          <p className="text-xs text-subtle">
            {scored.length === 0
              ? "Os projetos ainda são novos demais para um veredito."
              : "Nada pede atenção agora."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {needing.map((project) => (
              <NeedsAttention key={project.id} project={project} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NeedsAttention({ project }: { project: DashboardProject }) {
  return (
    <li className="flex flex-col gap-1 border-b border-hairline pb-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/projects/${project.id}`}
          className="min-w-0 truncate text-[13px] text-primary hover:text-sienna"
        >
          {project.name}
        </Link>
        <span className="flex shrink-0 items-center gap-1.5">
          <Badge tone={TONES[project.verdict]}>{VERDICT_LABELS[project.verdict]}</Badge>
          {project.score !== null ? (
            <span className="font-mono text-xs text-primary">{toDisplay(project.score)}</span>
          ) : null}
        </span>
      </div>
      <p className="text-xs text-subtle">{trendLabel(project.trend)}</p>
      {project.topFinding ? (
        <p className="truncate text-xs text-secondary">
          <span className="font-mono text-[11px] text-subtle">TSK-{project.topFinding.number}</span>{" "}
          {project.topFinding.title} · {SIGNAL_LABELS[project.topFinding.signal]}
        </p>
      ) : null}
    </li>
  );
}
