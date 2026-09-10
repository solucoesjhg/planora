/**
 * Project use cases (DEVELOPMENT_PLAN.md §7 Phase 5).
 *
 * The service authorizes and transacts; the decision about whether a project
 * may be called finished belongs to `domain/projects`, and is the same function
 * the interface will call to decide whether to even offer the button.
 */

import { keyBetween } from "@/domain/kanban";
import { canCompleteProject, type CompletionRefusal } from "@/domain/projects";
import type { CalendarDate } from "@/domain/types";
import { ok, refused, type Result } from "@/lib/result";
import { can, type TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { emit } from "@/server/events/outbox";
import { loadBoardContext } from "@/server/modules/board/repository";
import {
  ensureClient,
  findProject,
  insertProject,
  listProjects,
  softDeleteProject,
  updateProject,
  type ProjectSummary,
} from "./repository";

export type ProjectFailure =
  | CompletionRefusal
  | "forbidden"
  | "not-found"
  | "already-completed"
  | "already-active";

export type CreateProjectInput = {
  readonly name: string;
  readonly description?: string;
  readonly clientName?: string | undefined;
  readonly startDate?: CalendarDate | null;
  readonly dueDate?: CalendarDate | null;
};

export async function createProject(
  db: Database,
  context: TenantContext,
  input: CreateProjectInput,
): Promise<Result<{ projectId: string }, ProjectFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  return db.transaction(async (tx) => {
    const clientId = input.clientName?.trim()
      ? await ensureClient(tx, context, input.clientName)
      : null;

    const project = await insertProject(tx, context, {
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      clientId,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    });

    await emit(tx, {
      workspaceId: context.workspaceId,
      type: "project.created",
      payload: { projectId: project.id, name: project.name },
      dedupeKey: `project.created:${project.id}`,
      actorId: context.userId,
    });

    return ok({ projectId: project.id });
  });
}

export async function completeProject(
  db: Database,
  context: TenantContext,
  input: { projectId: string; ack?: CompletionRefusal },
): Promise<Result<{ projectId: string }, ProjectFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  return db.transaction(async (tx) => {
    const project = await findProject(tx, context, input.projectId);
    if (!project) return refused("not-found", input.projectId);
    if (project.status === "completed") {
      return refused("already-completed", project.id);
    }

    const board = await loadBoardContext(tx, context, project.id);
    const decision = canCompleteProject(board, input.ack);
    if (decision.kind === "refused") {
      // Nothing written: the refusal is the whole outcome.
      return refused(decision.reason, decision.detail);
    }

    await updateProject(tx, context, project.id, { status: "completed" });

    await emit(tx, {
      workspaceId: context.workspaceId,
      type: "project.completed",
      payload: {
        projectId: project.id,
        name: project.name,
        forced: input.ack === "open-work",
      },
      dedupeKey: `project.completed:${project.id}:${Date.now()}`,
      actorId: context.userId,
    });

    return ok({ projectId: project.id });
  });
}

export async function reopenProject(
  db: Database,
  context: TenantContext,
  projectId: string,
): Promise<Result<{ projectId: string }, ProjectFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  return db.transaction(async (tx) => {
    const project = await findProject(tx, context, projectId);
    if (!project) return refused("not-found", projectId);
    if (project.status === "active") return refused("already-active", projectId);

    await updateProject(tx, context, projectId, { status: "active" });

    await emit(tx, {
      workspaceId: context.workspaceId,
      type: "project.reopened",
      payload: { projectId, name: project.name },
      dedupeKey: `project.reopened:${projectId}:${Date.now()}`,
      actorId: context.userId,
    });

    return ok({ projectId });
  });
}

export type EditProjectInput = {
  readonly projectId: string;
  readonly name?: string;
  readonly description?: string;
  readonly clientName?: string | undefined;
  readonly startDate?: CalendarDate | null;
  readonly dueDate?: CalendarDate | null;
};

export async function editProject(
  db: Database,
  context: TenantContext,
  input: EditProjectInput,
): Promise<Result<{ projectId: string }, ProjectFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  return db.transaction(async (tx) => {
    const project = await findProject(tx, context, input.projectId);
    if (!project) return refused("not-found", input.projectId);

    const clientId =
      input.clientName === undefined
        ? undefined
        : input.clientName.trim()
          ? await ensureClient(tx, context, input.clientName)
          : null;

    await updateProject(tx, context, project.id, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.description === undefined
        ? {}
        : { description: input.description.trim() }),
      ...(clientId === undefined ? {} : { clientId }),
      ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
    });

    return ok({ projectId: project.id });
  });
}

export async function deleteProject(
  db: Database,
  context: TenantContext,
  projectId: string,
): Promise<Result<{ projectId: string }, ProjectFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  const project = await findProject(db, context, projectId);
  if (!project) return refused("not-found", projectId);

  await softDeleteProject(db, context, projectId);
  return ok({ projectId });
}

/**
 * Reordering writes one row: the moved project takes a key between its new
 * neighbours. The grid sends the ids it dropped between, not a whole order.
 */
export async function moveProject(
  db: Database,
  context: TenantContext,
  input: { projectId: string; afterId?: string | null; beforeId?: string | null },
): Promise<Result<{ position: string }, ProjectFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  const all = await listProjects(db, context);
  const moving = all.find((project) => project.id === input.projectId);
  if (!moving) return refused("not-found", input.projectId);

  const lower = positionOf(all, input.afterId);
  const upper = positionOf(all, input.beforeId);

  const position = keyBetween(lower, upper);
  await updateProject(db, context, input.projectId, { position });

  return ok({ position });
}

function positionOf(
  projects: readonly ProjectSummary[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return projects.find((project) => project.id === id)?.position ?? null;
}
