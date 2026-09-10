/**
 * Project reads and writes (DEVELOPMENT_PLAN.md §7 Phase 5).
 *
 * Every function takes the `TenantContext` first and filters by `workspace_id`.
 * The counts the grid shows are computed in the database rather than by loading
 * every task into memory to count it.
 */

import type { CalendarDate } from "@/domain/types";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { keyBetween } from "@/domain/kanban";
import type { Phase } from "@/domain/types";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { boardColumns, clients, projects, tasks } from "@/server/db/schema";

export type ProjectRow = typeof projects.$inferSelect;

export type ProjectSummary = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: "active" | "completed";
  readonly startDate: CalendarDate | null;
  readonly dueDate: CalendarDate | null;
  readonly position: string;
  readonly clientName: string | null;
  readonly totalTasks: number;
  readonly openTasks: number;
  readonly blockedTasks: number;
};

/** The four columns every project starts with, in board order. */
export const DEFAULT_COLUMNS: readonly { name: string; phase: Phase }[] = [
  { name: "Planejamento", phase: "planning" },
  { name: "Execução", phase: "execution" },
  { name: "Revisão", phase: "review" },
  { name: "Concluído", phase: "done" },
];

export async function listProjects(
  executor: Executor,
  context: TenantContext,
): Promise<ProjectSummary[]> {
  /**
   * "Blocked" here is the same union the domain uses: the manual flag, or a
   * dependency that has not reached a done column. Counting only the flag
   * would make the grid disagree with the rule that refuses completion.
   */
  const blocked = sql<number>`count(distinct ${tasks.id}) filter (
    where ${tasks.deletedAt} is null and (
      ${tasks.blocked}
      or exists (
        select 1
          from task_dependencies d
          join tasks dep on dep.id = d.depends_on_id and dep.deleted_at is null
          join board_columns dc on dc.id = dep.column_id
         where d.task_id = ${tasks.id} and dc.phase <> 'done'
      )
    )
  )::int`;

  const rows = await executor
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      position: projects.position,
      clientName: clients.name,
      totalTasks: sql<number>`count(distinct ${tasks.id}) filter (where ${tasks.deletedAt} is null)::int`,
      openTasks: sql<number>`count(distinct ${tasks.id}) filter (
        where ${tasks.deletedAt} is null and ${boardColumns.phase} <> 'done'
      )::int`,
      blockedTasks: blocked,
    })
    .from(projects)
    .leftJoin(
      clients,
      and(eq(clients.id, projects.clientId), eq(clients.workspaceId, context.workspaceId)),
    )
    .leftJoin(
      tasks,
      and(eq(tasks.projectId, projects.id), eq(tasks.workspaceId, context.workspaceId)),
    )
    .leftJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(
      and(
        eq(projects.workspaceId, context.workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .groupBy(projects.id, clients.name)
    .orderBy(asc(projects.position), asc(projects.id));

  return rows.map((row) => ({
    ...row,
    status: row.status as ProjectSummary["status"],
  }));
}

export async function findProject(
  executor: Executor,
  context: TenantContext,
  projectId: string,
): Promise<ProjectRow | null> {
  const [row] = await executor
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, context.workspaceId),
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

export type NewProject = {
  readonly name: string;
  readonly description?: string;
  readonly clientId?: string | null;
  readonly startDate?: CalendarDate | null;
  readonly dueDate?: CalendarDate | null;
};

/**
 * A project without its board is not a project. The columns are created in the
 * same transaction, which is also what satisfies "exactly one planning and one
 * done column" — the partial unique index can forbid a second, not require a
 * first (§4.4).
 */
export async function insertProject(
  executor: Executor,
  context: TenantContext,
  input: NewProject,
): Promise<ProjectRow> {
  const [row] = await executor
    .insert(projects)
    .values({
      workspaceId: context.workspaceId,
      name: input.name,
      description: input.description ?? "",
      clientId: input.clientId ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      position: keyBetween(await lastProjectPosition(executor, context), null),
      createdBy: context.userId,
    })
    .returning();

  if (!row) throw new Error("project insert returned nothing");

  let position: string | null = null;
  for (const column of DEFAULT_COLUMNS) {
    position = keyBetween(position, null);
    await executor.insert(boardColumns).values({
      workspaceId: context.workspaceId,
      projectId: row.id,
      name: column.name,
      phase: column.phase,
      position,
    });
  }

  return row;
}

export async function updateProject(
  executor: Executor,
  context: TenantContext,
  projectId: string,
  patch: Partial<Pick<ProjectRow, "name" | "description" | "clientId" | "startDate" | "dueDate" | "status" | "position">>,
): Promise<void> {
  await executor
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(projects.workspaceId, context.workspaceId), eq(projects.id, projectId)),
    );
}

export async function softDeleteProject(
  executor: Executor,
  context: TenantContext,
  projectId: string,
): Promise<void> {
  await executor
    .update(projects)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(projects.workspaceId, context.workspaceId), eq(projects.id, projectId)),
    );
}

export async function lastProjectPosition(
  executor: Executor,
  context: TenantContext,
): Promise<string | null> {
  const [row] = await executor
    .select({ position: sql<string | null>`max(${projects.position})` })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, context.workspaceId),
        isNull(projects.deletedAt),
      ),
    );

  return row?.position ?? null;
}

export async function listClients(executor: Executor, context: TenantContext) {
  return executor
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.workspaceId, context.workspaceId))
    .orderBy(asc(clients.name));
}

/** Names are unique per workspace, so the same client is never created twice. */
export async function ensureClient(
  executor: Executor,
  context: TenantContext,
  name: string,
): Promise<string> {
  const trimmed = name.trim();

  const [existing] = await executor
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(eq(clients.workspaceId, context.workspaceId), eq(clients.name, trimmed)),
    )
    .limit(1);

  if (existing) return existing.id;

  const [created] = await executor
    .insert(clients)
    .values({
      workspaceId: context.workspaceId,
      name: trimmed,
      createdBy: context.userId,
    })
    .returning({ id: clients.id });

  if (!created) throw new Error("client insert returned nothing");
  return created.id;
}
