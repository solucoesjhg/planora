/**
 * The time-based routines (DEVELOPMENT_PLAN.md §7 Phase 9): what the clock
 * notices that no click would. Each finding is an event with a dedupe key
 * of task and day, so a clock that ticks every minute says it once a day —
 * and a rule waiting for `task.overdue` fires once, not sixty times an hour.
 *
 * The clock is the system: its events sign as `automation`, with no person.
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import { STALE_THRESHOLD_DAYS } from "@/domain/health";
import {
  type Phase,
  calendarDateOf,
  calendarDaysBetween,
  daysBetween,
} from "@/domain/types";
import { tenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { boardColumns, projects, tasks } from "@/server/db/schema";
import { emit } from "@/server/events/outbox";
import { loadBoardContext } from "@/server/modules/board/repository";
import { evaluateProjectHealth } from "@/server/modules/health/service";

/** "Deadline approaching" — two days, as the plan defaults it. */
export const DUE_SOON_DAYS = 2;

export type RoutineSummary = {
  readonly dueSoon: number;
  readonly overdue: number;
  readonly stalled: number;
  readonly evaluated: number;
  readonly changed: number;
};

export async function runRoutines(db: Database, now: Date = new Date()): Promise<RoutineSummary> {
  const today = calendarDateOf(now);
  const summary = { dueSoon: 0, overdue: 0, stalled: 0, evaluated: 0, changed: 0 };

  const open = await db
    .select({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      projectId: tasks.projectId,
      dueDate: tasks.dueDate,
      enteredColumnAt: tasks.enteredColumnAt,
      phase: boardColumns.phase,
    })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(isNull(tasks.deletedAt), isNull(projects.deletedAt), ne(boardColumns.phase, "done")));

  for (const task of open) {
    const base = { workspaceId: task.workspaceId, actorKind: "automation" as const, actorId: null, occurredAt: now };
    const payload = { taskId: task.id, projectId: task.projectId };

    if (task.dueDate) {
      const days = calendarDaysBetween(today, task.dueDate);
      if (days >= 0 && days <= DUE_SOON_DAYS) {
        const id = await emit(db, {
          ...base,
          type: "task.due_soon",
          payload: { ...payload, dueDate: task.dueDate, daysLeft: days },
          dedupeKey: `task.due_soon:${task.id}:${today}`,
        });
        if (id) summary.dueSoon += 1;
      } else if (days < 0) {
        const id = await emit(db, {
          ...base,
          type: "task.overdue",
          payload: { ...payload, dueDate: task.dueDate, daysLate: -days },
          dedupeKey: `task.overdue:${task.id}:${today}`,
        });
        if (id) summary.overdue += 1;
      }
    }

    const threshold = STALE_THRESHOLD_DAYS[task.phase as Phase];
    const inColumn = daysBetween(task.enteredColumnAt, now);
    if (Number.isFinite(threshold) && inColumn > threshold) {
      const id = await emit(db, {
        ...base,
        type: "task.stalled",
        payload: { ...payload, phase: task.phase, days: Math.floor(inColumn) },
        dedupeKey: `task.stalled:${task.id}:${today}`,
      });
      if (id) summary.stalled += 1;
    }
  }

  // Every active project, evaluated once a day whether or not anybody opened
  // it — the row the dashboard used to write lazily, and the verdict that
  // fires "project entering Critical".
  const active = await db
    .select()
    .from(projects)
    .where(and(isNull(projects.deletedAt), eq(projects.status, "active")));

  for (const project of active) {
    const context = tenantContext(project.workspaceId, project.createdBy, "owner");
    const board = await loadBoardContext(db, context, project.id);
    const health = await evaluateProjectHealth(db, context, project, board, now);
    summary.evaluated += 1;
    if (health.changed) summary.changed += 1;
  }

  return summary;
}
