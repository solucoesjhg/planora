/**
 * What the multi-project dashboard shows (DEVELOPMENT_PLAN.md §7 Phase 8).
 *
 * Every project is read the way its own board reads it — context, progress,
 * health — and nothing is computed here that `domain/` does not compute:
 * this module gathers, evaluates and counts.
 */

import { type HealthReport, type TaskSignal, type Trend, type Verdict, VERDICTS } from "@/domain/health";
import { type ProjectProgress, projectProgress } from "@/domain/progress";
import { PHASES, type CalendarDate, type Phase, liveTasks, phaseOf } from "@/domain/types";
import type { TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { type ActivityEntry, latestActivity } from "@/server/modules/activity/repository";
import { loadBoardView, toDomainContext } from "@/server/modules/board/view";
import { evaluateProjectHealth } from "@/server/modules/health/service";
import { listProjects } from "@/server/modules/projects/repository";

export type DashboardProject = {
  readonly id: string;
  readonly name: string;
  readonly clientName: string | null;
  readonly dueDate: CalendarDate | null;
  readonly totalTasks: number;
  readonly openTasks: number;
  readonly blockedTasks: number;
  readonly progress: ProjectProgress;
  readonly verdict: Verdict;
  readonly score: number | null;
  readonly trend: Trend;
  /** The heaviest reason, when the engine found one. */
  readonly topFinding: {
    readonly signal: TaskSignal;
    readonly taskId: string;
    readonly number: number;
    readonly title: string;
  } | null;
  readonly byPhase: Record<Phase, number>;
};

export type Dashboard = {
  readonly projects: readonly DashboardProject[];
  readonly completedProjects: number;
  /** Live tasks across every active project, by the phase of their column. */
  readonly distribution: Record<Phase, number>;
  readonly verdicts: Record<Verdict, number>;
  readonly activity: readonly ActivityEntry[];
  /** Some verdict moved during this read; the caller drains the outbox. */
  readonly changed: boolean;
};

export async function loadDashboard(
  db: Database,
  context: TenantContext,
  now: Date = new Date(),
): Promise<Dashboard> {
  const [summaries, activity] = await Promise.all([
    listProjects(db, context),
    latestActivity(db, context, 20),
  ]);

  const active = summaries.filter((summary) => summary.status === "active");
  const projects: DashboardProject[] = [];
  let changed = false;

  for (const summary of active) {
    const view = await loadBoardView(db, context, summary.id);
    if (!view) continue;

    const board = toDomainContext(view);
    const health = await evaluateProjectHealth(db, context, summary, board, now);
    changed ||= health.changed;

    const byPhase = emptyByPhase();
    for (const task of liveTasks(board.tasks)) byPhase[phaseOf(task, board)] += 1;

    projects.push({
      id: summary.id,
      name: summary.name,
      clientName: summary.clientName,
      dueDate: summary.dueDate,
      totalTasks: summary.totalTasks,
      openTasks: summary.openTasks,
      blockedTasks: summary.blockedTasks,
      progress: projectProgress(board),
      verdict: health.report.verdict,
      score: health.report.score,
      trend: health.trend,
      topFinding: topFindingOf(health.report, view.tasks),
      byPhase,
    });
  }

  const distribution = emptyByPhase();
  const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<
    Verdict,
    number
  >;
  for (const project of projects) {
    for (const phase of PHASES) distribution[phase] += project.byPhase[phase];
    verdicts[project.verdict] += 1;
  }

  return {
    projects,
    completedProjects: summaries.length - active.length,
    distribution,
    verdicts,
    activity,
    changed,
  };
}

function emptyByPhase(): Record<Phase, number> {
  return { planning: 0, execution: 0, review: 0, done: 0 };
}

function topFindingOf(
  report: HealthReport,
  tasks: readonly { id: string; number: number; title: string }[],
): DashboardProject["topFinding"] {
  const first = report.topTwo[0];
  if (!first) return null;
  const task = tasks.find((each) => each.id === first.taskId);
  if (!task) return null;
  return { signal: first.signal, taskId: task.id, number: task.number, title: task.title };
}
