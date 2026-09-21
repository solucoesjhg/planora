import { AppShell } from "@/components/layout/app-shell";
import { ActivityFeed } from "@/features/dashboard/activity-feed";
import { DistributionChart } from "@/features/dashboard/distribution-chart";
import { PortfolioPanel } from "@/features/dashboard/portfolio-panel";
import { ProjectRows } from "@/features/dashboard/project-rows";
import { AccountBar } from "@/features/workspace/account-bar";
import { requireWorkspace } from "@/server/auth/dal";
import { withTenant } from "@/server/db/client";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { loadDashboard } from "@/server/modules/dashboard/view";

/**
 * The multi-project panel (DEVELOPMENT_PLAN.md §7 Phase 8): every active
 * project with its progress and verdict, where the work sits, what happened
 * last, and — in the right pane — who needs attention first.
 */
export default async function DashboardPage() {
  const workspace = await requireWorkspace();
  const now = new Date();

  // Reading the dashboard evaluates every active project, which writes each
  // one's row for today (§3.5); a verdict that moved is announced. One scope
  // around the whole load: it loops serially over the projects, and a scope
  // per project would cost two round trips each (ADR 0002).
  const dashboard = await withTenant(workspace, (tx) => loadDashboard(tx, workspace, now));
  if (dashboard.changed) dispatchSoon();

  const openTasks = dashboard.projects.reduce((sum, project) => sum + project.openTasks, 0);
  const blockedTasks = dashboard.projects.reduce(
    (sum, project) => sum + project.blockedTasks,
    0,
  );

  return (
    <AppShell
      title="Painel"
      account={<AccountBar />}
      panelTitle="Portfólio"
      panel={<PortfolioPanel dashboard={dashboard} role={workspace.role} />}
    >
      <div className="flex max-w-4xl flex-col gap-8">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="dashboard-totals">
          <Total label="Em andamento" value={dashboard.projects.length} />
          <Total label="Concluídos" value={dashboard.completedProjects} />
          <Total label="Tarefas abertas" value={openTasks} />
          <Total label="Travadas" value={blockedTasks} tone={blockedTasks > 0 ? "warn" : "plain"} />
        </dl>

        <ProjectRows projects={dashboard.projects} now={now} />

        <DistributionChart counts={dashboard.distribution} />

        <ActivityFeed entries={dashboard.activity} now={now} />
      </div>
    </AppShell>
  );
}

function Total({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number;
  tone?: "plain" | "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-card border border-line bg-card p-3">
      <dt className="text-[11px] tracking-[0.12em] text-subtle uppercase">{label}</dt>
      <dd
        className={
          tone === "warn"
            ? "pln-display text-2xl text-danger"
            : "pln-display text-2xl text-primary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
