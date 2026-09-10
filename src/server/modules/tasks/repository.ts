/**
 * The task as a document: reads and writes (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * Same contract as every repository here — the `TenantContext` first, and
 * `workspace_id` in every `where`. These functions fetch and write; what may
 * happen is decided in `service.ts`, and why it may happen, in the domain.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import {
  attachments,
  boardColumns,
  projects,
  taskChecklistItems,
  taskComments,
  taskDependencies,
  taskPhaseHistory,
  tasks,
  users,
} from "@/server/db/schema";

export type TaskRow = typeof tasks.$inferSelect;
export type ChecklistRow = typeof taskChecklistItems.$inferSelect;
export type CommentRow = typeof taskComments.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

export type TaskDocument = {
  readonly task: TaskRow;
  readonly project: { id: string; name: string };
  readonly column: { id: string; name: string; phase: string };
  readonly checklist: readonly ChecklistRow[];
  readonly dependsOn: readonly {
    id: string;
    taskId: string;
    title: string;
    number: number;
    phase: string;
  }[];
  readonly blocks: readonly { taskId: string; title: string; number: number }[];
  readonly comments: readonly (CommentRow & { authorName: string })[];
  readonly files: readonly AttachmentRow[];
  readonly history: readonly {
    at: Date;
    fromPhase: string | null;
    toPhase: string;
    columnName: string | null;
  }[];
};

const alive = (context: TenantContext) =>
  and(eq(tasks.workspaceId, context.workspaceId), isNull(tasks.deletedAt));

export async function findTask(
  executor: Executor,
  context: TenantContext,
  taskId: string,
): Promise<TaskRow | null> {
  const [row] = await executor
    .select()
    .from(tasks)
    .where(and(alive(context), eq(tasks.id, taskId)))
    .limit(1);

  return row ?? null;
}

/** Everything the detail view shows, in one round of queries. */
export async function loadTaskDocument(
  executor: Executor,
  context: TenantContext,
  taskId: string,
): Promise<TaskDocument | null> {
  const task = await findTask(executor, context, taskId);
  if (!task) return null;

  const dependsOnTasks = alias(tasks, "depends_on_task");
  const blockedTasks = alias(tasks, "blocked_task");

  const [
    [project],
    [column],
    checklist,
    dependsOn,
    blocks,
    comments,
    files,
    history,
  ] = await Promise.all([
    executor
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, context.workspaceId),
          eq(projects.id, task.projectId),
        ),
      )
      .limit(1),

    executor
      .select({ id: boardColumns.id, name: boardColumns.name, phase: boardColumns.phase })
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.workspaceId, context.workspaceId),
          eq(boardColumns.id, task.columnId),
        ),
      )
      .limit(1),

    executor
      .select()
      .from(taskChecklistItems)
      .where(
        and(
          eq(taskChecklistItems.workspaceId, context.workspaceId),
          eq(taskChecklistItems.taskId, taskId),
        ),
      )
      .orderBy(asc(taskChecklistItems.position)),

    executor
      .select({
        id: taskDependencies.id,
        taskId: dependsOnTasks.id,
        title: dependsOnTasks.title,
        number: dependsOnTasks.number,
        phase: boardColumns.phase,
      })
      .from(taskDependencies)
      .innerJoin(
        dependsOnTasks,
        and(
          eq(dependsOnTasks.workspaceId, context.workspaceId),
          eq(dependsOnTasks.id, taskDependencies.dependsOnId),
        ),
      )
      .innerJoin(
        boardColumns,
        and(
          eq(boardColumns.workspaceId, context.workspaceId),
          eq(boardColumns.id, dependsOnTasks.columnId),
        ),
      )
      .where(
        and(
          eq(taskDependencies.workspaceId, context.workspaceId),
          eq(taskDependencies.taskId, taskId),
        ),
      ),

    executor
      .select({
        taskId: blockedTasks.id,
        title: blockedTasks.title,
        number: blockedTasks.number,
      })
      .from(taskDependencies)
      .innerJoin(
        blockedTasks,
        and(
          eq(blockedTasks.workspaceId, context.workspaceId),
          eq(blockedTasks.id, taskDependencies.taskId),
        ),
      )
      .where(
        and(
          eq(taskDependencies.workspaceId, context.workspaceId),
          eq(taskDependencies.dependsOnId, taskId),
        ),
      ),

    executor
      .select({
        id: taskComments.id,
        workspaceId: taskComments.workspaceId,
        taskId: taskComments.taskId,
        authorId: taskComments.authorId,
        body: taskComments.body,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
        authorName: users.name,
      })
      .from(taskComments)
      .innerJoin(users, eq(users.id, taskComments.authorId))
      .where(
        and(
          eq(taskComments.workspaceId, context.workspaceId),
          eq(taskComments.taskId, taskId),
        ),
      )
      .orderBy(asc(taskComments.createdAt)),

    executor
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.workspaceId, context.workspaceId),
          eq(attachments.taskId, taskId),
          eq(attachments.status, "stored"),
        ),
      )
      .orderBy(desc(attachments.createdAt)),

    executor
      .select({
        at: taskPhaseHistory.at,
        fromPhase: taskPhaseHistory.fromPhase,
        toPhase: taskPhaseHistory.toPhase,
        columnName: boardColumns.name,
      })
      .from(taskPhaseHistory)
      .leftJoin(
        boardColumns,
        and(
          eq(boardColumns.workspaceId, context.workspaceId),
          eq(boardColumns.id, taskPhaseHistory.toColumnId),
        ),
      )
      .where(
        and(
          eq(taskPhaseHistory.workspaceId, context.workspaceId),
          eq(taskPhaseHistory.taskId, taskId),
        ),
      )
      .orderBy(desc(taskPhaseHistory.at)),
  ]);

  if (!project || !column) return null;

  return { task, project, column, checklist, dependsOn, blocks, comments, files, history };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export async function updateTaskRow(
  executor: Executor,
  context: TenantContext,
  taskId: string,
  values: Partial<typeof tasks.$inferInsert>,
): Promise<void> {
  await executor
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.id, taskId)));
}

/** TSK-N is per project and never reused, so it is read under the row lock. */
export async function nextTaskNumber(
  executor: Executor,
  context: TenantContext,
  projectId: string,
): Promise<number> {
  const [row] = await executor
    .select({ highest: sql<number>`coalesce(max(${tasks.number}), 0)` })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.projectId, projectId)),
    );

  return (row?.highest ?? 0) + 1;
}

export async function lastChecklistPosition(
  executor: Executor,
  context: TenantContext,
  taskId: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ position: taskChecklistItems.position })
    .from(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.workspaceId, context.workspaceId),
        eq(taskChecklistItems.taskId, taskId),
      ),
    )
    .orderBy(desc(taskChecklistItems.position))
    .limit(1);

  return row?.position ?? null;
}

export async function checklistOf(
  executor: Executor,
  context: TenantContext,
  taskId: string,
): Promise<ChecklistRow[]> {
  return executor
    .select()
    .from(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.workspaceId, context.workspaceId),
        eq(taskChecklistItems.taskId, taskId),
      ),
    )
    .orderBy(asc(taskChecklistItems.position));
}

export async function findChecklistItem(
  executor: Executor,
  context: TenantContext,
  itemId: string,
): Promise<ChecklistRow | null> {
  const [row] = await executor
    .select()
    .from(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.workspaceId, context.workspaceId),
        eq(taskChecklistItems.id, itemId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findComment(
  executor: Executor,
  context: TenantContext,
  commentId: string,
): Promise<CommentRow | null> {
  const [row] = await executor
    .select()
    .from(taskComments)
    .where(
      and(
        eq(taskComments.workspaceId, context.workspaceId),
        eq(taskComments.id, commentId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The tasks of a project, for the dependency picker and the domain context. */
export async function tasksOfProject(
  executor: Executor,
  context: TenantContext,
  projectId: string,
): Promise<{ id: string; number: number; title: string; columnId: string }[]> {
  return executor
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      columnId: tasks.columnId,
    })
    .from(tasks)
    .where(and(alive(context), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.number));
}

export async function dependencyIdsOf(
  executor: Executor,
  context: TenantContext,
  taskIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();

  const rows = await executor
    .select({
      taskId: taskDependencies.taskId,
      dependsOnId: taskDependencies.dependsOnId,
    })
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.workspaceId, context.workspaceId),
        inArray(taskDependencies.taskId, [...taskIds]),
      ),
    );

  const byTask = new Map<string, string[]>();
  for (const row of rows) {
    byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), row.dependsOnId]);
  }
  return byTask;
}
