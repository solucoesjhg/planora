/**
 * Moving a task (DEVELOPMENT_PLAN.md §2.3, §3.6).
 *
 * The service authorizes, opens the transaction and asks the domain. It does
 * not re-implement the rule: `canMoveTask` is the same function the board calls
 * during a drag, so a forged request meets exactly the refusal the interface
 * already showed.
 */

import { canMoveTask, keyBetween, type MoveRefusal } from "@/domain/kanban";
import { ok, refused, type Result } from "@/lib/result";
import { archiveNotes } from "@/domain/phase-history";
import type { Phase } from "@/domain/types";
import { columnById, taskById } from "@/domain/types";
import { can, type TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { emit } from "@/server/events/outbox";
import {
  applyMove,
  findColumn,
  findTask,
  lastPositionIn,
  loadBoardContext,
  positionsOfTasks,
  recordPhaseChange,
} from "./repository";

export type MoveTaskFailure = MoveRefusal | "not-found" | "forbidden";

export type MoveTaskInput = {
  readonly taskId: string;
  readonly toColumnId: string;
  /** Only `checklist` can be acknowledged, and it travels from the client. */
  readonly ack?: MoveRefusal;
  readonly now?: Date;
  /** How the phase left behind is titled in the archived note (pt-BR at the edge). */
  readonly phaseLabel?: (phase: Phase) => string;
  /**
   * Where the card landed, as the two cards it was dropped between. The board
   * sends neighbours rather than an index, so a stale list on the client cannot
   * reorder a column it did not mean to touch. Both absent means the end.
   */
  readonly afterTaskId?: string | null;
  readonly beforeTaskId?: string | null;
};

export type MoveTaskSuccess = {
  readonly taskId: string;
  readonly columnId: string;
  readonly eventId: string | null;
};

export async function moveTask(
  db: Database,
  context: TenantContext,
  input: MoveTaskInput,
): Promise<Result<MoveTaskSuccess, MoveTaskFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const row = await findTask(tx, context, input.taskId);
    if (!row) return refused("not-found", input.taskId);

    const target = await findColumn(tx, context, input.toColumnId);
    if (!target || target.projectId !== row.projectId) {
      return refused("not-found", input.toColumnId);
    }

    const board = await loadBoardContext(tx, context, row.projectId);
    const task = taskById(board, row.id);
    const from = columnById(board, row.columnId);
    const to = columnById(board, target.id);
    if (!task || !from || !to) return refused("not-found", input.taskId);

    const decision = canMoveTask({
      task,
      from,
      to,
      context: board,
      ...(input.ack ? { ack: input.ack } : {}),
    });
    if (decision.kind === "refused") {
      // Nothing has been written: the refusal is the whole outcome.
      return refused(decision.reason, decision.detail);
    }

    const phaseChanged = from.phase !== to.phase;
    const archived = phaseChanged
      ? archiveNotes({
          body: row.body,
          notes: row.internalNotes,
          label: input.phaseLabel?.(from.phase) ?? from.phase,
          at: now,
        })
      : { body: row.body, notes: row.internalNotes };

    const neighbours = await positionsOfTasks(tx, context, [
      input.afterTaskId ?? "",
      input.beforeTaskId ?? "",
    ]);
    const lower = input.afterTaskId
      ? (neighbours.get(input.afterTaskId) ?? null)
      : input.beforeTaskId
        ? null
        : await lastPositionIn(tx, context, to.id);
    const upper = input.beforeTaskId
      ? (neighbours.get(input.beforeTaskId) ?? null)
      : null;

    await applyMove(tx, context, row.id, {
      columnId: to.id,
      position: keyBetween(lower, upper),
      enteredColumnAt: now,
      body: archived.body,
      internalNotes: archived.notes,
    });

    await recordPhaseChange(tx, context, {
      taskId: row.id,
      fromColumnId: from.id,
      toColumnId: to.id,
      fromPhase: from.phase,
      toPhase: to.phase,
      at: now,
    });

    // Exactly one event per move, in the mutation's own transaction.
    const eventId = await emit(tx, {
      workspaceId: context.workspaceId,
      type: "task.moved",
      payload: {
        taskId: row.id,
        projectId: row.projectId,
        fromColumnId: from.id,
        toColumnId: to.id,
        fromPhase: from.phase,
        toPhase: to.phase,
        completed: to.phase === "done",
        forced: input.ack === "checklist",
      },
      dedupeKey: `task.moved:${row.id}:${to.id}:${now.getTime()}`,
      actorKind: "user",
      actorId: context.userId,
    });

    return ok({ taskId: row.id, columnId: to.id, eventId });
  });
}
