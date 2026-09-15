/**
 * What the health service reads and writes (DEVELOPMENT_PLAN.md §3.5, §7 Phase 8).
 *
 * The engine is pure: it takes the previous evaluation and the week's
 * activity as inputs. This module is where those come from — the snapshot
 * table for the first, the event stream of Phase 2 for the second — and where
 * today's row goes.
 */

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type {
  HealthReport,
  HealthSnapshot,
  HistoryPoint,
  Verdict,
} from "@/domain/health";
import type { CalendarDate } from "@/domain/types";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { outboxEvents, projectHealthSnapshots, tasks } from "@/server/db/schema";

export type SnapshotRow = typeof projectHealthSnapshots.$inferSelect;

/**
 * The last evaluation before `today` — the one hysteresis defends. Today's
 * own row is deliberately not it: a project read twice in a day would
 * otherwise count as two consecutive evaluations and flip its verdict.
 */
export async function previousSnapshot(
  executor: Executor,
  context: TenantContext,
  projectId: string,
  today: CalendarDate,
): Promise<HealthSnapshot | null> {
  const [row] = await executor
    .select({
      verdict: projectHealthSnapshots.verdict,
      rawVerdict: projectHealthSnapshots.rawVerdict,
      score: projectHealthSnapshots.score,
    })
    .from(projectHealthSnapshots)
    .where(
      and(
        eq(projectHealthSnapshots.workspaceId, context.workspaceId),
        eq(projectHealthSnapshots.projectId, projectId),
        lt(projectHealthSnapshots.date, today),
      ),
    )
    .orderBy(desc(projectHealthSnapshots.date))
    .limit(1);

  if (!row) return null;
  return {
    verdict: row.verdict as Verdict,
    rawVerdict: row.rawVerdict as Verdict,
    score: row.score,
  };
}

/** Every evaluation from `since` on, oldest first. */
export async function historyOf(
  executor: Executor,
  context: TenantContext,
  projectId: string,
  since: CalendarDate,
): Promise<HistoryPoint[]> {
  return executor
    .select({ date: projectHealthSnapshots.date, score: projectHealthSnapshots.score })
    .from(projectHealthSnapshots)
    .where(
      and(
        eq(projectHealthSnapshots.workspaceId, context.workspaceId),
        eq(projectHealthSnapshots.projectId, projectId),
        gte(projectHealthSnapshots.date, since),
      ),
    )
    .orderBy(asc(projectHealthSnapshots.date));
}

/**
 * Today's row, written or rewritten: the unique index on `(project_id, date)`
 * is what makes evaluating on every read idempotent.
 */
export async function writeSnapshot(
  executor: Executor,
  context: TenantContext,
  projectId: string,
  date: CalendarDate,
  report: Pick<HealthReport, "score" | "verdict" | "rawVerdict" | "dimensions">,
): Promise<void> {
  const values = {
    score: report.score,
    verdict: report.verdict,
    rawVerdict: report.rawVerdict,
    flow: report.dimensions.flow,
    pace: report.dimensions.pace,
    punctuality: report.dimensions.punctuality,
    freshness: report.dimensions.freshness,
    momentum: report.dimensions.momentum,
  };

  await executor
    .insert(projectHealthSnapshots)
    .values({ workspaceId: context.workspaceId, projectId, date, ...values })
    .onConflictDoUpdate({
      target: [projectHealthSnapshots.projectId, projectHealthSnapshots.date],
      set: { ...values, updatedAt: new Date() },
    });
}

/** What counts as touching a task (§3.5, Momentum): moved, completed, checked, commented. */
const TOUCH_EVENTS = [
  "task.moved",
  "task.completed",
  "checklist.completed",
  "comment.added",
] as const;

/**
 * The tasks of one project somebody touched since `since`, read from the
 * event stream itself rather than from the activity feed derived from it: the
 * feed is written a moment later by the dispatcher, and momentum should see a
 * move the instant it was made.
 */
export async function touchedTaskIds(
  executor: Executor,
  context: TenantContext,
  projectId: string,
  since: Date,
): Promise<Set<string>> {
  const taskId = sql<string>`(${outboxEvents.payload} ->> 'taskId')::uuid`;

  const rows = await executor
    .selectDistinct({ taskId: tasks.id })
    .from(outboxEvents)
    .innerJoin(tasks, and(eq(tasks.id, taskId), eq(tasks.workspaceId, context.workspaceId)))
    .where(
      and(
        eq(outboxEvents.workspaceId, context.workspaceId),
        eq(tasks.projectId, projectId),
        inArray(outboxEvents.type, [...TOUCH_EVENTS]),
        gte(outboxEvents.occurredAt, since),
      ),
    );

  return new Set(rows.map((row) => row.taskId));
}

/** The latest snapshot of every project in the workspace, for the dashboard. */
export async function latestSnapshots(
  executor: Executor,
  context: TenantContext,
): Promise<Map<string, SnapshotRow>> {
  const rows = await executor
    .selectDistinctOn([projectHealthSnapshots.projectId])
    .from(projectHealthSnapshots)
    .where(eq(projectHealthSnapshots.workspaceId, context.workspaceId))
    .orderBy(projectHealthSnapshots.projectId, desc(projectHealthSnapshots.date));

  return new Map(rows.map((row) => [row.projectId, row]));
}
