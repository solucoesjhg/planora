/**
 * The progress engine (DEVELOPMENT_PLAN.md §3.2 – §3.4).
 *
 * Phase decides the band, the checklist fills it, and blocking is a
 * project-level signal rather than a discount on the task itself.
 */

import { isBlocked } from "./dependencies";
import {
  type BoardColumn,
  type BoardContext,
  type Phase,
  type Task,
  byBoardOrder,
  columnById,
  columnsInPhase,
  liveTasks,
  round1,
} from "./types";

export type Band = { readonly floor: number; readonly ceiling: number };

export const PHASE_BANDS: Record<Phase, Band> = {
  planning: { floor: 0, ceiling: 0 },
  execution: { floor: 30, ceiling: 69 },
  review: { floor: 70, ceiling: 99 },
  done: { floor: 100, ceiling: 100 },
};

/**
 * A phase holding several columns splits its band evenly between them, in
 * board order (D1). Two execution columns give 30–49.5 and 49.5–69, so moving
 * a card one column right is always visible progress.
 */
export function slotFor(
  column: BoardColumn,
  columnsOfPhase: readonly BoardColumn[],
): Band {
  const band = PHASE_BANDS[column.phase];
  const siblings = columnsOfPhase
    .filter((candidate) => candidate.phase === column.phase)
    .sort(byBoardOrder);

  const index = siblings.findIndex((candidate) => candidate.id === column.id);
  const count = siblings.length;
  if (count <= 1 || index < 0) return band;

  const span = (band.ceiling - band.floor) / count;
  return {
    floor: round1(band.floor + index * span),
    ceiling: round1(band.floor + (index + 1) * span),
  };
}

export function taskProgress(
  task: Task,
  column: BoardColumn,
  columnsOfPhase: readonly BoardColumn[],
): number {
  if (column.phase === "planning") return 0;
  if (column.phase === "done") return 100;

  const { floor, ceiling } = slotFor(column, columnsOfPhase);
  const ratio =
    task.checklist.total === 0 ? 0 : task.checklist.done / task.checklist.total;

  return round1(Math.min(ceiling, floor + ratio * (ceiling - floor)));
}

/** Progress of one task, resolving its column from the board. */
export function taskProgressIn(task: Task, context: BoardContext): number {
  const column = columnById(context, task.columnId);
  if (!column) return 0;
  return taskProgress(task, column, columnsInPhase(context, column.phase));
}

export type ProjectProgress = {
  /** The work as it stands. */
  readonly raw: number;
  /** The same, with blocked work contributing nothing (D2). */
  readonly adjusted: number;
};

export function projectProgress(context: BoardContext): ProjectProgress {
  const tasks = liveTasks(context.tasks);
  if (tasks.length === 0) return { raw: 0, adjusted: 0 };

  let rawTotal = 0;
  let adjustedTotal = 0;
  let anythingOutstanding = false;

  for (const task of tasks) {
    const value = taskProgressIn(task, context);
    rawTotal += value;
    adjustedTotal += isBlocked(task, context) ? 0 : value;
    if (value < 100) anythingOutstanding = true;
  }

  return {
    raw: lock(rawTotal / tasks.length, anythingOutstanding),
    adjusted: lock(adjustedTotal / tasks.length, anythingOutstanding),
  };
}

/** Nothing rounds up to 100 while a task sits outside the done column. */
function lock(value: number, anythingOutstanding: boolean): number {
  const rounded = round1(value);
  return anythingOutstanding ? Math.min(99, rounded) : rounded;
}
