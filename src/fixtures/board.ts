/**
 * Sample data for tests and the /_dev routes. Never imported by a component.
 *
 * The clock is frozen: every date derives from SEED_EPOCH, so a fixture built
 * today is the fixture built next year.
 */

import type {
  BoardColumn,
  BoardContext,
  Project,
  Task,
} from "@/domain/types";
import { DAY_MS } from "@/domain/types";

export const SEED_EPOCH = new Date("2026-09-01T12:00:00.000Z");

export function daysBefore(days: number, from: Date = SEED_EPOCH): Date {
  return new Date(from.getTime() - days * DAY_MS);
}

export function daysAfter(days: number, from: Date = SEED_EPOCH): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export const columns = {
  planning: { id: "col-planning", phase: "planning", position: "V" },
  execution: { id: "col-execution", phase: "execution", position: "l" },
  review: { id: "col-review", phase: "review", position: "t" },
  done: { id: "col-done", phase: "done", position: "x" },
} as const satisfies Record<string, BoardColumn>;

export const allColumns: BoardColumn[] = [
  columns.planning,
  columns.execution,
  columns.review,
  columns.done,
];

let sequence = 0;

export function makeTask(overrides: Partial<Task> = {}): Task {
  sequence += 1;
  return {
    id: `TSK-${sequence}`,
    columnId: columns.execution.id,
    priority: "medium",
    checklist: { total: 0, done: 0 },
    blocked: false,
    dependsOn: [],
    dueDate: null,
    enteredColumnAt: daysBefore(1),
    deletedAt: null,
    ...overrides,
  };
}

export function makeBoard(
  tasks: readonly Task[],
  boardColumns: readonly BoardColumn[] = allColumns,
): BoardContext {
  return { columns: [...boardColumns], tasks: [...tasks] };
}

export const project: Project = {
  startDate: daysBefore(30),
  dueDate: daysAfter(30),
  createdAt: daysBefore(30),
};
