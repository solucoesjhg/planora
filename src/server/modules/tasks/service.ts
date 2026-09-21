/**
 * The task as a document: what may change, and what changing it means
 * (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * The rules that belong to the domain are asked, never re-implemented here:
 * `canAddDependency` for the graph, `archiveNotes` for the phase trail. What
 * this file owns is authorization, the transaction, and the events a change
 * leaves behind.
 *
 * The transaction is no longer the service's own: `inScope` reuses the scope the
 * Server Action opened, so each of these becomes a savepoint inside it and the
 * settings the policies read stay applied throughout (ADR 0002). The four that
 * never opened one — a checklist item removed, a dependency removed, a comment
 * edited or removed — write on the executor they are handed, which from the
 * entry point down is that same transaction.
 */

import { and, eq, inArray } from "drizzle-orm";
import { canAddDependency, type DependencyRefusal } from "@/domain/dependencies";
import { keyBetween } from "@/domain/kanban";
import type { BoardContext, CalendarDate, Priority } from "@/domain/types";
import { ok, refused, type Result } from "@/lib/result";
import { can, provenance, type TenantContext } from "@/server/auth/tenant";
import { isBlankRichText, sanitizeRichText } from "@/server/content/html";
import { inScope, type Executor } from "@/server/db/client";
import {
  taskChecklistItems,
  taskComments,
  taskDependencies,
  tasks,
  users,
  workspaceMembers,
} from "@/server/db/schema";
import { emit } from "@/server/events/outbox";
import { lastPositionIn, loadBoardContext } from "@/server/modules/board/repository";
import {
  checklistOf,
  findChecklistItem,
  findComment,
  findTask,
  lastChecklistPosition,
  nextTaskNumber,
  replaceAssignees,
  updateTaskRow,
} from "./repository";

export type TaskFailure = "forbidden" | "not-found" | "empty" | "too-long";
/** Somebody named who is not in this workspace. */
export type AssignFailure = TaskFailure | "not-a-member";
export type DependencyFailure = TaskFailure | DependencyRefusal;

const TITLE_LIMIT = 200;

/* ------------------------------------------------------------------ *
 * The task itself
 * ------------------------------------------------------------------ */

export type CreateTaskInput = {
  readonly projectId: string;
  readonly columnId: string;
  readonly title: string;
  readonly priority?: Priority;
  readonly dueDate?: CalendarDate | null;
  /** A subtask is a task with a parent (§4.3); a rule's "create a subtask" sets it. */
  readonly parentTaskId?: string | null;
};

export async function createTask(
  db: Executor,
  context: TenantContext,
  input: CreateTaskInput,
): Promise<Result<{ taskId: string; number: number }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const title = input.title.trim();
  if (title.length === 0) return refused("empty", "title");
  if (title.length > TITLE_LIMIT) return refused("too-long", "title");

  return inScope(db, context, async (tx) => {
    const board = await loadBoardContext(tx, context, input.projectId);
    const target = board.columns.find((each) => each.id === input.columnId);
    if (!target) return refused("not-found", input.columnId);

    const last = await lastPositionIn(tx, context, target.id);
    const number = await nextTaskNumber(tx, context, input.projectId);

    const [created] = await tx
      .insert(tasks)
      .values({
        workspaceId: context.workspaceId,
        projectId: input.projectId,
        columnId: target.id,
        number,
        title,
        priority: input.priority ?? "medium",
        dueDate: input.dueDate ?? null,
        parentTaskId: input.parentTaskId ?? null,
        position: keyBetween(last, null),
        createdBy: context.userId,
      })
      .returning({ id: tasks.id });

    if (!created) return refused("not-found", input.projectId);

    await emit(tx, {
      workspaceId: context.workspaceId,
      type: "task.created",
      payload: {
        taskId: created.id,
        projectId: input.projectId,
        columnId: target.id,
        number,
        title,
      },
      dedupeKey: `task.created:${created.id}`,
      ...provenance(context),
    });

    return ok({ taskId: created.id, number });
  });
}

export type UpdateTaskInput = {
  readonly taskId: string;
  readonly title?: string;
  readonly body?: string;
  readonly internalNotes?: string;
  readonly priority?: Priority;
  readonly startDate?: CalendarDate | null;
  readonly dueDate?: CalendarDate | null;
  readonly blocked?: boolean;
  readonly blockReason?: string | null;
  readonly now?: Date;
};

export async function updateTask(
  db: Executor,
  context: TenantContext,
  input: UpdateTaskInput,
): Promise<Result<{ taskId: string }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const now = input.now ?? new Date();

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length === 0) return refused("empty", "title");
    if (title.length > TITLE_LIMIT) return refused("too-long", "title");
  }

  return inScope(db, context, async (tx) => {
    const task = await findTask(tx, context, input.taskId);
    if (!task) return refused("not-found", input.taskId);

    const values: Partial<typeof tasks.$inferInsert> = {};
    if (input.title !== undefined) values.title = input.title.trim();
    // Everything written in an editor is a proposal until it is sanitized.
    if (input.body !== undefined) values.body = sanitizeRichText(input.body);
    if (input.internalNotes !== undefined) {
      values.internalNotes = sanitizeRichText(input.internalNotes);
    }
    if (input.priority !== undefined) values.priority = input.priority;
    if (input.startDate !== undefined) values.startDate = input.startDate;
    if (input.dueDate !== undefined) values.dueDate = input.dueDate;

    const blocking = input.blocked !== undefined && input.blocked !== task.blocked;
    if (blocking) {
      values.blocked = input.blocked;
      values.blockedAt = input.blocked ? now : null;
      values.blockReason = input.blocked ? (input.blockReason?.trim() ?? null) : null;
    } else if (input.blockReason !== undefined && task.blocked) {
      values.blockReason = input.blockReason?.trim() ?? null;
    }

    await updateTaskRow(tx, context, task.id, values);

    if (blocking) {
      await emit(tx, {
        workspaceId: context.workspaceId,
        type: input.blocked ? "task.blocked" : "task.unblocked",
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          reason: values.blockReason ?? null,
        },
        dedupeKey: `task.${input.blocked ? "blocked" : "unblocked"}:${task.id}:${now.getTime()}`,
        ...provenance(context),
      });
    }

    return ok({ taskId: task.id });
  });
}

/* ------------------------------------------------------------------ *
 * Assignees (§7 Phase 8)
 * ------------------------------------------------------------------ */

export type AssignTaskInput = {
  readonly taskId: string;
  /** The whole set: whoever is not named stops being responsible. */
  readonly userIds: readonly string[];
  readonly now?: Date;
};

/**
 * Who a task belongs to. Anyone named has to be in the workspace — the
 * composite foreign key would not refuse a user id from another tenant, since
 * `users` is global — and the event carries the names, so the feed can say
 * who without a lookup that would answer differently after somebody renamed.
 */
export async function assignTask(
  db: Executor,
  context: TenantContext,
  input: AssignTaskInput,
): Promise<Result<{ taskId: string }, AssignFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const now = input.now ?? new Date();
  const userIds = [...new Set(input.userIds)];

  return inScope(db, context, async (tx) => {
    const task = await findTask(tx, context, input.taskId);
    if (!task) return refused("not-found", input.taskId);

    const members =
      userIds.length === 0
        ? []
        : await tx
            .select({ userId: users.id, name: users.name })
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .where(
              and(
                eq(workspaceMembers.workspaceId, context.workspaceId),
                inArray(workspaceMembers.userId, userIds),
              ),
            );
    const stranger = userIds.find((id) => !members.some((member) => member.userId === id));
    if (stranger) return refused("not-a-member", stranger);

    await replaceAssignees(tx, context, task.id, userIds);

    await emit(tx, {
      workspaceId: context.workspaceId,
      type: "task.assigned",
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        userIds,
        names: userIds.map((id) => members.find((member) => member.userId === id)?.name ?? ""),
      },
      dedupeKey: `task.assigned:${task.id}:${now.getTime()}`,
      ...provenance(context),
    });

    return ok({ taskId: task.id });
  });
}

/* ------------------------------------------------------------------ *
 * Checklist
 * ------------------------------------------------------------------ */

export async function addChecklistItem(
  db: Executor,
  context: TenantContext,
  input: { taskId: string; title: string },
): Promise<Result<{ itemId: string }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const title = input.title.trim();
  if (title.length === 0) return refused("empty", "title");
  if (title.length > TITLE_LIMIT) return refused("too-long", "title");

  return inScope(db, context, async (tx) => {
    const task = await findTask(tx, context, input.taskId);
    if (!task) return refused("not-found", input.taskId);

    const last = await lastChecklistPosition(tx, context, task.id);
    const [item] = await tx
      .insert(taskChecklistItems)
      .values({
        workspaceId: context.workspaceId,
        taskId: task.id,
        title,
        position: keyBetween(last, null),
      })
      .returning({ id: taskChecklistItems.id });

    return item ? ok({ itemId: item.id }) : refused("not-found", input.taskId);
  });
}

export async function setChecklistItem(
  db: Executor,
  context: TenantContext,
  input: { itemId: string; done?: boolean; title?: string },
): Promise<Result<{ itemId: string; checklistCompleted: boolean }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  if (input.title !== undefined && input.title.trim().length === 0) {
    return refused("empty", "title");
  }

  return inScope(db, context, async (tx) => {
    const item = await findChecklistItem(tx, context, input.itemId);
    if (!item) return refused("not-found", input.itemId);

    await tx
      .update(taskChecklistItems)
      .set({
        ...(input.done === undefined ? {} : { done: input.done }),
        ...(input.title === undefined ? {} : { title: input.title.trim() }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taskChecklistItems.workspaceId, context.workspaceId),
          eq(taskChecklistItems.id, item.id),
        ),
      );

    // The last open item closing is worth an event: §3.6 lets a checklist stand
    // between a task and `done`, so finishing one is news.
    const items = await checklistOf(tx, context, item.taskId);
    const completed =
      items.length > 0 && items.every((each) => each.done) && input.done === true;

    if (completed) {
      const task = await findTask(tx, context, item.taskId);
      await emit(tx, {
        workspaceId: context.workspaceId,
        type: "checklist.completed",
        payload: {
          taskId: item.taskId,
          projectId: task?.projectId ?? null,
          items: items.length,
        },
        dedupeKey: `checklist.completed:${item.taskId}:${items.length}`,
        ...provenance(context),
      });
    }

    return ok({ itemId: item.id, checklistCompleted: completed });
  });
}

export async function removeChecklistItem(
  db: Executor,
  context: TenantContext,
  itemId: string,
): Promise<Result<{ itemId: string }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const item = await findChecklistItem(db, context, itemId);
  if (!item) return refused("not-found", itemId);

  await db
    .delete(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.workspaceId, context.workspaceId),
        eq(taskChecklistItems.id, itemId),
      ),
    );

  return ok({ itemId });
}

/* ------------------------------------------------------------------ *
 * Dependencies
 * ------------------------------------------------------------------ */

export async function addDependency(
  db: Executor,
  context: TenantContext,
  input: { taskId: string; dependsOnId: string },
): Promise<Result<{ dependencyId: string }, DependencyFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  return inScope(db, context, async (tx) => {
    const task = await findTask(tx, context, input.taskId);
    const dependency = await findTask(tx, context, input.dependsOnId);
    if (!task || !dependency) return refused("not-found", input.dependsOnId);
    if (task.projectId !== dependency.projectId) {
      return refused("not-found", input.dependsOnId);
    }

    const board: BoardContext = await loadBoardContext(tx, context, task.projectId);
    const decision = canAddDependency(task.id, dependency.id, board);
    if (decision.kind === "refused") return refused(decision.reason, decision.detail);

    const [row] = await tx
      .insert(taskDependencies)
      .values({
        workspaceId: context.workspaceId,
        taskId: task.id,
        dependsOnId: dependency.id,
      })
      .returning({ id: taskDependencies.id });

    return row ? ok({ dependencyId: row.id }) : refused("duplicate", task.id);
  });
}

export async function removeDependency(
  db: Executor,
  context: TenantContext,
  dependencyId: string,
): Promise<Result<{ dependencyId: string }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const deleted = await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.workspaceId, context.workspaceId),
        eq(taskDependencies.id, dependencyId),
      ),
    )
    .returning({ id: taskDependencies.id });

  return deleted.length > 0
    ? ok({ dependencyId })
    : refused("not-found", dependencyId);
}

/* ------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------ */

export async function addComment(
  db: Executor,
  context: TenantContext,
  input: { taskId: string; body: string },
): Promise<Result<{ commentId: string }, TaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const body = sanitizeRichText(input.body);
  if (isBlankRichText(body)) return refused("empty", "body");

  return inScope(db, context, async (tx) => {
    const task = await findTask(tx, context, input.taskId);
    if (!task) return refused("not-found", input.taskId);

    const [comment] = await tx
      .insert(taskComments)
      .values({
        workspaceId: context.workspaceId,
        taskId: task.id,
        authorId: context.userId,
        actorKind: provenance(context).actorKind,
        body,
      })
      .returning({ id: taskComments.id });

    if (!comment) return refused("not-found", input.taskId);

    await emit(tx, {
      workspaceId: context.workspaceId,
      type: "comment.added",
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        commentId: comment.id,
      },
      dedupeKey: `comment.added:${comment.id}`,
      ...provenance(context),
    });

    return ok({ commentId: comment.id });
  });
}

export async function editComment(
  db: Executor,
  context: TenantContext,
  input: { commentId: string; body: string },
): Promise<Result<{ commentId: string }, TaskFailure>> {
  const comment = await findComment(db, context, input.commentId);
  if (!comment) return refused("not-found", input.commentId);
  // Editing what somebody else wrote is not a matter of role.
  if (comment.authorId !== context.userId) return refused("forbidden", "author");

  const body = sanitizeRichText(input.body);
  if (isBlankRichText(body)) return refused("empty", "body");

  await db
    .update(taskComments)
    .set({ body, updatedAt: new Date() })
    .where(
      and(
        eq(taskComments.workspaceId, context.workspaceId),
        eq(taskComments.id, comment.id),
      ),
    );

  return ok({ commentId: comment.id });
}

export async function removeComment(
  db: Executor,
  context: TenantContext,
  commentId: string,
): Promise<Result<{ commentId: string }, TaskFailure>> {
  const comment = await findComment(db, context, commentId);
  if (!comment) return refused("not-found", commentId);

  // Its author, or somebody who manages the project it was said in (§4.2.1).
  const isAuthor = comment.authorId === context.userId;
  if (!isAuthor && !can(context, "manage-project")) {
    return refused("forbidden", context.role);
  }

  await db
    .delete(taskComments)
    .where(
      and(
        eq(taskComments.workspaceId, context.workspaceId),
        eq(taskComments.id, commentId),
      ),
    );

  return ok({ commentId });
}
