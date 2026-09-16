/**
 * Board reads and writes (DEVELOPMENT_PLAN.md §2.1, §2.4).
 *
 * Every function takes the `TenantContext` first, and every query filters by
 * `workspace_id`. No repository reads a session, and none of them decides
 * anything — that is the service's job, and the rule's.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BoardColumn, BoardContext, Task } from "@/domain/types";
import { provenance, type TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import {
  boardColumns,
  taskChecklistItems,
  taskDependencies,
  taskPhaseHistory,
  tasks,
} from "@/server/db/schema";

export type TaskRow = typeof tasks.$inferSelect;
export type ColumnRow = typeof boardColumns.$inferSelect;

export async function findTask(
  executor: Executor,
  context: TenantContext,
  taskId: string,
): Promise<TaskRow | null> {
  const [row] = await executor
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, context.workspaceId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findColumn(
  executor: Executor,
  context: TenantContext,
  columnId: string,
): Promise<ColumnRow | null> {
  const [row] = await executor
    .select()
    .from(boardColumns)
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.id, columnId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Everything the domain needs to reason about one project. */
export async function loadBoardContext(
  executor: Executor,
  context: TenantContext,
  projectId: string,
): Promise<BoardContext> {
  const scope = and(
    eq(tasks.workspaceId, context.workspaceId),
    eq(tasks.projectId, projectId),
    isNull(tasks.deletedAt),
  );

  const [columnRows, taskRows, checklistRows, dependencyRows] = await Promise.all([
    executor
      .select()
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.workspaceId, context.workspaceId),
          eq(boardColumns.projectId, projectId),
        ),
      ),
    executor.select().from(tasks).where(scope),
    executor
      .select({
        taskId: taskChecklistItems.taskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${taskChecklistItems.done})::int`,
      })
      .from(taskChecklistItems)
      .innerJoin(tasks, eq(tasks.id, taskChecklistItems.taskId))
      .where(scope)
      .groupBy(taskChecklistItems.taskId),
    executor
      .select({
        taskId: taskDependencies.taskId,
        dependsOnId: taskDependencies.dependsOnId,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(scope),
  ]);

  const checklists = new Map(
    checklistRows.map((row) => [row.taskId, { total: row.total, done: row.done }]),
  );
  const dependencies = new Map<string, string[]>();
  for (const row of dependencyRows) {
    dependencies.set(row.taskId, [
      ...(dependencies.get(row.taskId) ?? []),
      row.dependsOnId,
    ]);
  }

  return {
    columns: columnRows.map(toDomainColumn),
    tasks: taskRows.map((row) =>
      toDomainTask(row, checklists.get(row.id), dependencies.get(row.id)),
    ),
  };
}

export function toDomainColumn(row: ColumnRow): BoardColumn {
  return {
    id: row.id,
    phase: row.phase as BoardColumn["phase"],
    position: row.position,
  };
}

export function toDomainTask(
  row: TaskRow,
  checklist: { total: number; done: number } | undefined,
  dependsOn: readonly string[] | undefined,
): Task {
  return {
    id: row.id,
    columnId: row.columnId,
    priority: row.priority as Task["priority"],
    checklist: checklist ?? { total: 0, done: 0 },
    blocked: row.blocked,
    dependsOn: dependsOn ?? [],
    dueDate: row.dueDate,
    enteredColumnAt: row.enteredColumnAt,
    deletedAt: row.deletedAt,
  };
}

/** The last ordering key in a column, so a move can append after it. */
/** Every live card in a column, in board order. */
export async function positionsIn(
  executor: Executor,
  context: TenantContext,
  columnId: string,
): Promise<{ id: string; position: string }[]> {
  return executor
    .select({ id: tasks.id, position: tasks.position })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, context.workspaceId),
        eq(tasks.columnId, columnId),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(tasks.position), asc(tasks.id));
}

/** Rewrites the order of a column, one statement per card. */
export async function rewritePositions(
  executor: Executor,
  context: TenantContext,
  ordered: readonly { id: string; position: string }[],
): Promise<void> {
  for (const row of ordered) {
    await executor
      .update(tasks)
      .set({ position: row.position, updatedAt: new Date() })
      .where(
        and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.id, row.id)),
      );
  }
}

export async function lastPositionIn(
  executor: Executor,
  context: TenantContext,
  columnId: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ position: sql<string>`max(${tasks.position})` })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, context.workspaceId),
        eq(tasks.columnId, columnId),
        isNull(tasks.deletedAt),
      ),
    );

  return row?.position ?? null;
}

/** The ordering keys of specific tasks, for placing a card between two others. */
export async function positionsOfTasks(
  executor: Executor,
  context: TenantContext,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return new Map();

  const rows = await executor
    .select({ id: tasks.id, position: tasks.position })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, context.workspaceId), inArray(tasks.id, wanted)),
    );

  return new Map(rows.map((row) => [row.id, row.position]));
}

export type MovePatch = {
  readonly columnId: string;
  readonly position: string;
  readonly enteredColumnAt: Date;
  readonly body: string;
  readonly internalNotes: string;
};

export async function applyMove(
  executor: Executor,
  context: TenantContext,
  taskId: string,
  patch: MovePatch,
): Promise<void> {
  await executor
    .update(tasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.id, taskId)));
}

export async function recordPhaseChange(
  executor: Executor,
  context: TenantContext,
  entry: {
    taskId: string;
    fromColumnId: string;
    toColumnId: string;
    fromPhase: string;
    toPhase: string;
    at: Date;
  },
): Promise<void> {
  await executor.insert(taskPhaseHistory).values({
    workspaceId: context.workspaceId,
    taskId: entry.taskId,
    fromColumnId: entry.fromColumnId,
    toColumnId: entry.toColumnId,
    fromPhase: entry.fromPhase,
    toPhase: entry.toPhase,
    at: entry.at,
    actorKind: provenance(context).actorKind,
    actorId: provenance(context).actorId,
  });
}
