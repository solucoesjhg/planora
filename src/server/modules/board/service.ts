/**
 * Moving a task (DEVELOPMENT_PLAN.md §2.3, §3.6).
 *
 * The service authorizes, opens the transaction and asks the domain. It does
 * not re-implement the rule: `canMoveTask` is the same function the board calls
 * during a drag, so a forged request meets exactly the refusal the interface
 * already showed.
 */

import { unresolvedDependencies } from "@/domain/dependencies";
import {
  canMoveTask,
  keyBetween,
  needsRebalance,
  rebalance,
  type MoveRefusal,
} from "@/domain/kanban";
import { ok, refused, type Result } from "@/lib/result";
import { archiveNotes } from "@/domain/phase-history";
import type { BoardContext, Phase } from "@/domain/types";
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
  positionsIn,
  positionsOfTasks,
  recordPhaseChange,
  rewritePositions,
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

    /**
     * Fractional keys grow when cards keep landing between the same two
     * neighbours. The comment on `needsRebalance` claimed a column rebalanced
     * itself and nothing did it — so here it is, in the same transaction as
     * the move that grew the key, and only for the column it grew in.
     */
    const settled = await positionsIn(tx, context, to.id);
    if (needsRebalance(settled.map((row) => row.position))) {
      const fresh = rebalance(settled.length);
      await rewritePositions(
        tx,
        context,
        settled.map((row, index) => ({ id: row.id, position: fresh[index]! })),
      );
    }

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

    /**
     * Entering `done` is an event of its own (§4.5): the health engine's
     * Momentum and Phase 9's rules read "completed", not "moved somewhere". And
     * whoever was waiting on this task, and now waits on nothing, is released
     * — `dependency.resolved` is emitted for each of them here, because this is
     * the transaction that knows.
     */
    if (to.phase === "done" && from.phase !== "done") {
      await emit(tx, {
        workspaceId: context.workspaceId,
        type: "task.completed",
        payload: {
          taskId: row.id,
          projectId: row.projectId,
          columnId: to.id,
          forced: input.ack === "checklist",
        },
        dedupeKey: `task.completed:${row.id}:${now.getTime()}`,
        actorKind: "user",
        actorId: context.userId,
      });

      const after: BoardContext = {
        columns: board.columns,
        tasks: board.tasks.map((each) =>
          each.id === row.id ? { ...each, columnId: to.id } : each,
        ),
      };

      for (const waiting of after.tasks) {
        if (waiting.deletedAt !== null) continue;
        if (!waiting.dependsOn.includes(row.id)) continue;
        if (unresolvedDependencies(waiting, after).length > 0) continue;

        await emit(tx, {
          workspaceId: context.workspaceId,
          type: "dependency.resolved",
          payload: {
            taskId: waiting.id,
            projectId: row.projectId,
            resolvedBy: row.id,
          },
          dedupeKey: `dependency.resolved:${waiting.id}:${row.id}:${now.getTime()}`,
          actorKind: "user",
          actorId: context.userId,
        });
      }
    }

    return ok({ taskId: row.id, columnId: to.id, eventId });
  });
}
