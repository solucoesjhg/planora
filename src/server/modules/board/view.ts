/**
 * What the board needs to render, and what the client needs to decide
 * (DEVELOPMENT_PLAN.md §7 Phase 6).
 *
 * The view carries every field `domain/` reads, so the client island can
 * rebuild a `BoardContext` and call `canMoveTask()` itself — that is what lets
 * a refused drag bounce without touching the network. Dates cross the boundary
 * as ISO strings because a Server Component cannot hand a `Date` to a client
 * component untouched.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { BoardContext, Phase, Priority } from "@/domain/types";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import {
  boardColumns,
  projects,
  taskChecklistItems,
  taskDependencies,
  tasks,
} from "@/server/db/schema";

export type BoardColumnView = {
  readonly id: string;
  readonly name: string;
  readonly phase: Phase;
  readonly position: string;
};

export type BoardTaskView = {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly columnId: string;
  readonly position: string;
  readonly priority: Priority;
  readonly blocked: boolean;
  readonly blockReason: string | null;
  readonly dueDate: string | null;
  readonly enteredColumnAt: string;
  readonly checklist: { readonly total: number; readonly done: number };
  readonly dependsOn: readonly string[];
};

export type BoardView = {
  readonly project: { readonly id: string; readonly name: string; readonly status: string };
  readonly columns: readonly BoardColumnView[];
  readonly tasks: readonly BoardTaskView[];
};

export async function loadBoardView(
  executor: Executor,
  context: TenantContext,
  projectId: string,
): Promise<BoardView | null> {
  const [project] = await executor
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, context.workspaceId),
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);

  if (!project) return null;

  const scope = and(
    eq(tasks.workspaceId, context.workspaceId),
    eq(tasks.projectId, projectId),
    isNull(tasks.deletedAt),
  );

  const [columnRows, taskRows, checklistRows, dependencyRows] = await Promise.all([
    executor
      .select({
        id: boardColumns.id,
        name: boardColumns.name,
        phase: boardColumns.phase,
        position: boardColumns.position,
      })
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
    project,
    columns: columnRows.map((row) => ({ ...row, phase: row.phase as Phase })),
    tasks: taskRows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      columnId: row.columnId,
      position: row.position,
      priority: row.priority as Priority,
      blocked: row.blocked,
      blockReason: row.blockReason,
      dueDate: row.dueDate,
      enteredColumnAt: row.enteredColumnAt.toISOString(),
      checklist: checklists.get(row.id) ?? { total: 0, done: 0 },
      dependsOn: dependencies.get(row.id) ?? [],
    })),
  };
}

/**
 * The same board, in the shape the rules speak. Shared by the client island and
 * anything on the server that already holds a view.
 */
export function toDomainContext(view: {
  columns: readonly BoardColumnView[];
  tasks: readonly BoardTaskView[];
}): BoardContext {
  return {
    columns: view.columns.map((column) => ({
      id: column.id,
      phase: column.phase,
      position: column.position,
    })),
    tasks: view.tasks.map((task) => ({
      id: task.id,
      columnId: task.columnId,
      priority: task.priority,
      checklist: task.checklist,
      blocked: task.blocked,
      dependsOn: task.dependsOn,
      dueDate: task.dueDate,
      enteredColumnAt: new Date(task.enteredColumnAt),
      deletedAt: null,
    })),
  };
}
