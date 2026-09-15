/**
 * Workspace export (DEVELOPMENT_PLAN.md §6.2, §7 Phase 8): everything the
 * workspace holds, as JSON for a machine or CSV for a spreadsheet. The v1 had
 * a JSON backup of `localStorage`; this is the same promise kept against the
 * database.
 *
 * The serializers are pure, so what "one row per task" means is tested
 * without a database.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import {
  boardColumns,
  clients,
  projects,
  taskAssignees,
  taskChecklistItems,
  taskComments,
  taskDependencies,
  tasks,
  users,
  workspaces,
} from "@/server/db/schema";

export type ExportedTask = {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly internalNotes: string;
  readonly column: string;
  readonly phase: string;
  readonly priority: string;
  readonly blocked: boolean;
  readonly blockReason: string | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly assignees: readonly string[];
  readonly dependsOn: readonly number[];
  readonly checklist: readonly { readonly title: string; readonly done: boolean }[];
  readonly comments: readonly { readonly author: string; readonly body: string; readonly at: string }[];
  readonly createdAt: string;
};

export type ExportedProject = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly client: string | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly columns: readonly { readonly name: string; readonly phase: string }[];
  readonly tasks: readonly ExportedTask[];
};

export type WorkspaceExport = {
  readonly workspace: { readonly id: string; readonly name: string };
  readonly exportedAt: string;
  readonly projects: readonly ExportedProject[];
};

export async function loadWorkspaceExport(
  executor: Executor,
  context: TenantContext,
  now: Date = new Date(),
): Promise<WorkspaceExport | null> {
  const [workspace] = await executor
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, context.workspaceId))
    .limit(1);
  if (!workspace) return null;

  const scope = eq(tasks.workspaceId, context.workspaceId);

  const [projectRows, columnRows, taskRows, assigneeRows, dependencyRows, checklistRows, commentRows] =
    await Promise.all([
      executor
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          status: projects.status,
          client: clients.name,
          startDate: projects.startDate,
          dueDate: projects.dueDate,
        })
        .from(projects)
        .leftJoin(
          clients,
          and(eq(clients.workspaceId, context.workspaceId), eq(clients.id, projects.clientId)),
        )
        .where(and(eq(projects.workspaceId, context.workspaceId), isNull(projects.deletedAt)))
        .orderBy(asc(projects.position), asc(projects.id)),
      executor
        .select({
          id: boardColumns.id,
          projectId: boardColumns.projectId,
          name: boardColumns.name,
          phase: boardColumns.phase,
          position: boardColumns.position,
        })
        .from(boardColumns)
        .where(eq(boardColumns.workspaceId, context.workspaceId))
        .orderBy(asc(boardColumns.position)),
      executor
        .select()
        .from(tasks)
        .where(and(scope, isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.number)),
      executor
        .select({ taskId: taskAssignees.taskId, name: users.name })
        .from(taskAssignees)
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(eq(taskAssignees.workspaceId, context.workspaceId)),
      executor
        .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
        .from(taskDependencies)
        .where(eq(taskDependencies.workspaceId, context.workspaceId)),
      executor
        .select({
          taskId: taskChecklistItems.taskId,
          title: taskChecklistItems.title,
          done: taskChecklistItems.done,
        })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.workspaceId, context.workspaceId))
        .orderBy(asc(taskChecklistItems.position)),
      executor
        .select({
          taskId: taskComments.taskId,
          author: users.name,
          body: taskComments.body,
          at: taskComments.createdAt,
        })
        .from(taskComments)
        .innerJoin(users, eq(users.id, taskComments.authorId))
        .where(eq(taskComments.workspaceId, context.workspaceId))
        .orderBy(asc(taskComments.createdAt)),
    ]);

  const columnsById = new Map(columnRows.map((column) => [column.id, column]));
  const numberById = new Map(taskRows.map((task) => [task.id, task.number]));
  const byTask = <T extends { taskId: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.taskId, [...(map.get(row.taskId) ?? []), row]);
    return map;
  };
  const assignees = byTask(assigneeRows);
  const dependencies = byTask(dependencyRows);
  const checklists = byTask(checklistRows);
  const comments = byTask(commentRows);

  return {
    workspace,
    exportedAt: now.toISOString(),
    projects: projectRows.map((project) => ({
      ...project,
      columns: columnRows
        .filter((column) => column.projectId === project.id)
        .map((column) => ({ name: column.name, phase: column.phase })),
      tasks: taskRows
        .filter((task) => task.projectId === project.id)
        .map((task) => {
          const column = columnsById.get(task.columnId);
          return {
            id: task.id,
            number: task.number,
            title: task.title,
            body: task.body,
            internalNotes: task.internalNotes,
            column: column?.name ?? "",
            phase: column?.phase ?? "",
            priority: task.priority,
            blocked: task.blocked,
            blockReason: task.blockReason,
            startDate: task.startDate,
            dueDate: task.dueDate,
            assignees: (assignees.get(task.id) ?? []).map((row) => row.name),
            dependsOn: (dependencies.get(task.id) ?? [])
              .map((row) => numberById.get(row.dependsOnId))
              .filter((number): number is number => number !== undefined),
            checklist: (checklists.get(task.id) ?? []).map((row) => ({
              title: row.title,
              done: row.done,
            })),
            comments: (comments.get(task.id) ?? []).map((row) => ({
              author: row.author,
              body: row.body,
              at: row.at.toISOString(),
            })),
            createdAt: task.createdAt.toISOString(),
          };
        }),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Serializers — pure
 * ------------------------------------------------------------------ */

export function toJson(data: WorkspaceExport): string {
  return JSON.stringify(data, null, 2);
}

/** One row per task, the way a spreadsheet wants it. */
export const CSV_COLUMNS = [
  "projeto",
  "tarefa",
  "titulo",
  "fase",
  "coluna",
  "prioridade",
  "travada",
  "motivo",
  "inicio",
  "prazo",
  "responsaveis",
  "depende_de",
  "checklist_feito",
  "checklist_total",
  "comentarios",
  "criada_em",
] as const;

export function toCsv(data: WorkspaceExport): string {
  const lines = [CSV_COLUMNS.join(",")];

  for (const project of data.projects) {
    for (const task of project.tasks) {
      lines.push(
        [
          project.name,
          `TSK-${task.number}`,
          task.title,
          task.phase,
          task.column,
          task.priority,
          task.blocked ? "sim" : "não",
          task.blockReason ?? "",
          task.startDate ?? "",
          task.dueDate ?? "",
          task.assignees.join("; "),
          task.dependsOn.map((number) => `TSK-${number}`).join("; "),
          String(task.checklist.filter((item) => item.done).length),
          String(task.checklist.length),
          String(task.comments.length),
          task.createdAt,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  // A byte-order mark, so Excel opens the accents as accents.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** RFC 4180: quote when needed, double the quotes inside. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
