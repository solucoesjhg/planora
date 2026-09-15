import "server-only";

import type { Priority } from "@/domain/types";
import { can, type TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { attachmentUrl } from "./attachments";
import { membersOf } from "@/server/modules/workspaces/repository";
import { loadTaskDocument, tasksOfProject } from "./repository";

/**
 * The task, shaped for the screen (DEVELOPMENT_PLAN.md §2.2).
 *
 * Dates leave as ISO strings, and every file arrives as its stable address
 * rather than a signed URL: a page left open for ten minutes would otherwise
 * hold links that have already expired.
 */

export type TaskFileView = {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly url: string;
  readonly isImage: boolean;
};

export type TaskView = {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly internalNotes: string;
  readonly priority: Priority;
  readonly blocked: boolean;
  readonly blockReason: string | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly project: { readonly id: string; readonly name: string };
  readonly column: {
    readonly id: string;
    readonly name: string;
    readonly phase: string;
  };
  readonly checklist: readonly {
    readonly id: string;
    readonly title: string;
    readonly done: boolean;
  }[];
  readonly dependsOn: readonly {
    readonly id: string;
    readonly taskId: string;
    readonly number: number;
    readonly title: string;
    readonly done: boolean;
  }[];
  readonly blocks: readonly {
    readonly taskId: string;
    readonly number: number;
    readonly title: string;
  }[];
  readonly comments: readonly {
    readonly id: string;
    readonly body: string;
    readonly authorName: string;
    readonly mine: boolean;
    readonly createdAt: string;
    readonly edited: boolean;
  }[];
  readonly files: readonly TaskFileView[];
  /** Who the task belongs to, and who it could be given to. */
  readonly assignees: readonly { readonly userId: string; readonly name: string }[];
  readonly members: readonly { readonly userId: string; readonly name: string }[];
  readonly history: readonly {
    readonly at: string;
    readonly fromPhase: string | null;
    readonly toPhase: string;
    readonly columnName: string | null;
  }[];
  /** Candidates for a new dependency: everything else in the project. */
  readonly siblings: readonly {
    readonly id: string;
    readonly number: number;
    readonly title: string;
  }[];
  readonly canWrite: boolean;
};

export async function loadTaskView(
  db: Database,
  context: TenantContext,
  taskId: string,
): Promise<TaskView | null> {
  const document = await loadTaskDocument(db, context, taskId);
  if (!document) return null;

  const dependsOnIds = new Set(document.dependsOn.map((each) => each.taskId));

  const files = document.files.map((file) => ({
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    url: attachmentUrl(file.id),
    isImage: file.mime.startsWith("image/"),
  }));

  const [siblings, members] = await Promise.all([
    tasksOfProject(db, context, document.task.projectId),
    membersOf(db, context),
  ]);

  return {
    id: document.task.id,
    number: document.task.number,
    title: document.task.title,
    body: document.task.body,
    internalNotes: document.task.internalNotes,
    priority: document.task.priority as Priority,
    blocked: document.task.blocked,
    blockReason: document.task.blockReason,
    startDate: isoDay(document.task.startDate),
    dueDate: isoDay(document.task.dueDate),
    project: document.project,
    column: document.column,
    assignees: document.assignees,
    members: members.map((member) => ({ userId: member.userId, name: member.name })),

    checklist: document.checklist.map((item) => ({
      id: item.id,
      title: item.title,
      done: item.done,
    })),

    dependsOn: document.dependsOn.map((each) => ({
      id: each.id,
      taskId: each.taskId,
      number: each.number,
      title: each.title,
      done: each.phase === "done",
    })),

    blocks: document.blocks.map((each) => ({
      taskId: each.taskId,
      number: each.number,
      title: each.title,
    })),

    comments: document.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorName: comment.authorName,
      mine: comment.authorId === context.userId,
      createdAt: comment.createdAt.toISOString(),
      edited: comment.updatedAt.getTime() - comment.createdAt.getTime() > 1000,
    })),

    files,

    history: document.history.map((entry) => ({
      at: entry.at.toISOString(),
      fromPhase: entry.fromPhase,
      toPhase: entry.toPhase,
      columnName: entry.columnName,
    })),

    siblings: siblings
      .filter((task) => task.id !== document.task.id && !dependsOnIds.has(task.id))
      .map((task) => ({ id: task.id, number: task.number, title: task.title })),

    canWrite: can(context, "write-task"),
  };
}

function isoDay(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}
