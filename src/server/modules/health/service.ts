/**
 * Evaluating a project's health (DEVELOPMENT_PLAN.md §3.5, §7 Phase 8).
 *
 * One call does what the plan describes: read the last evaluation and the
 * week's activity, ask the engine, write today's row, and emit
 * `project.health_changed` when — and only when — the verdict moved. Until
 * Phase 9's clock exists this runs whenever a project is read, which the
 * unique index on `(project_id, date)` makes harmless.
 *
 * No number is computed here. The engine returns them; this module stores and
 * relays them.
 */

import {
  type HealthReport,
  type HistoryPoint,
  type Trend,
  projectHealth,
  trendOf,
} from "@/domain/health";
import {
  type BoardContext,
  type CalendarDate,
  DAY_MS,
  calendarDateOf,
  isDone,
  liveTasks,
} from "@/domain/types";
import type { TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { emit } from "@/server/events/outbox";
import { historyOf, previousSnapshot, touchedTaskIds, writeSnapshot } from "./repository";

/** The window Momentum looks at, and how far back the trend line reads. */
export const ACTIVITY_WINDOW_DAYS = 7;
export const HISTORY_DAYS = 30;

export type ProjectForHealth = {
  readonly id: string;
  readonly startDate: CalendarDate | null;
  readonly dueDate: CalendarDate | null;
  readonly createdAt: Date;
};

export type ProjectHealthView = {
  readonly report: HealthReport;
  readonly trend: Trend;
  readonly history: readonly HistoryPoint[];
  /** The verdict moved and an event was written; the caller drains the outbox. */
  readonly changed: boolean;
};

export async function evaluateProjectHealth(
  db: Database,
  context: TenantContext,
  project: ProjectForHealth,
  board: BoardContext,
  now: Date = new Date(),
): Promise<ProjectHealthView> {
  const today = calendarDateOf(now);
  const windowStart = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);

  const [previous, touched] = await Promise.all([
    previousSnapshot(db, context, project.id, today),
    touchedTaskIds(db, context, project.id, windowStart),
  ]);

  // Every task open at any point in the window: one finished on Tuesday stays
  // in the denominator, or finishing work would lower momentum (§3.5).
  const openDuringWindow = new Set(
    liveTasks(board.tasks)
      .filter((task) => !isDone(task, board) || task.enteredColumnAt >= windowStart)
      .map((task) => task.id),
  );

  const report = projectHealth({
    project: {
      startDate: project.startDate,
      dueDate: project.dueDate,
      createdAt: project.createdAt,
    },
    context: board,
    activity: { touched, openDuringWindow },
    now,
    previous,
  });

  const changed = previous !== null && previous.verdict !== report.verdict;

  await db.transaction(async (tx) => {
    await writeSnapshot(tx, context, project.id, today, report);

    if (changed) {
      // The verdict is the system's, not the reader's: nobody signs it (§4.6).
      await emit(tx, {
        workspaceId: context.workspaceId,
        type: "project.health_changed",
        payload: {
          projectId: project.id,
          from: previous.verdict,
          to: report.verdict,
          score: report.score,
        },
        dedupeKey: `project.health_changed:${project.id}:${today}:${report.verdict}`,
        actorKind: "automation",
        actorId: null,
        occurredAt: now,
      });
    }
  });

  const since = calendarDateOf(new Date(now.getTime() - HISTORY_DAYS * DAY_MS));
  const history = await historyOf(db, context, project.id, since);

  return { report, trend: trendOf(history), history, changed };
}
