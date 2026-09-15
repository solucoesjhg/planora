/**
 * The activity feed (DEVELOPMENT_PLAN.md §4.5, §7 Phase 8).
 *
 * `activity_logs` is the far end of the outbox: one row per event, written by
 * the dispatcher. The feed shows the newest rows with the names a sentence
 * needs — who, which task, which project, which column — resolved here rather
 * than looked up one by one while rendering.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { activityLogs, boardColumns, projects, tasks, users } from "@/server/db/schema";

export type ActivityEntry = {
  readonly id: string;
  readonly verb: string;
  readonly actorKind: string;
  readonly actorName: string | null;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: Date;
  readonly taskNumber: number | null;
  readonly taskTitle: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly columnName: string | null;
};

export async function latestActivity(
  executor: Executor,
  context: TenantContext,
  limit = 20,
): Promise<ActivityEntry[]> {
  // A move names where the card went; a creation names where it landed.
  const columnRef = sql`coalesce(${activityLogs.data} ->> 'toColumnId', ${activityLogs.data} ->> 'columnId')::uuid`;
  // A task's project, or the project itself, or the one the payload names.
  const projectRef = sql`coalesce(${tasks.projectId}, ${activityLogs.subjectId}, (${activityLogs.data} ->> 'projectId')::uuid)`;

  const rows = await executor
    .select({
      id: activityLogs.id,
      verb: activityLogs.verb,
      actorKind: activityLogs.actorKind,
      actorName: users.name,
      subjectType: activityLogs.subjectType,
      subjectId: activityLogs.subjectId,
      data: activityLogs.data,
      createdAt: activityLogs.createdAt,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      projectId: projects.id,
      projectName: projects.name,
      columnName: boardColumns.name,
    })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.actorId))
    .leftJoin(
      tasks,
      and(eq(tasks.id, activityLogs.subjectId), eq(tasks.workspaceId, context.workspaceId)),
    )
    .leftJoin(
      projects,
      and(eq(projects.workspaceId, context.workspaceId), eq(projects.id, projectRef)),
    )
    .leftJoin(
      boardColumns,
      and(eq(boardColumns.workspaceId, context.workspaceId), eq(boardColumns.id, columnRef)),
    )
    .where(eq(activityLogs.workspaceId, context.workspaceId))
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    data: (row.data ?? {}) as Record<string, unknown>,
  }));
}
