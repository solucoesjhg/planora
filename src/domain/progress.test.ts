import { describe, expect, it } from "vitest";
import { allColumns, columns, makeBoard, makeTask } from "@/fixtures/board";
import { projectProgress, slotFor, taskProgress, taskProgressIn } from "./progress";
import type { BoardColumn } from "./types";

const executionOnly = [columns.execution];

describe("taskProgress", () => {
  it("gives planning nothing and done everything", () => {
    const task = makeTask({ checklist: { total: 4, done: 4 } });

    expect(taskProgress(task, columns.planning, [columns.planning])).toBe(0);
    expect(taskProgress(task, columns.done, [columns.done])).toBe(100);
  });

  it("puts a task with no checklist at the floor of its slot", () => {
    const task = makeTask({ checklist: { total: 0, done: 0 } });

    expect(taskProgress(task, columns.execution, executionOnly)).toBe(30);
  });

  it("fills the band with the checklist", () => {
    const half = makeTask({ checklist: { total: 4, done: 2 } });
    const full = makeTask({ checklist: { total: 4, done: 4 } });

    expect(taskProgress(half, columns.execution, executionOnly)).toBe(49.5);
    expect(taskProgress(full, columns.execution, executionOnly)).toBe(69);
  });

  it("stops a full checklist in review at 99, never 100", () => {
    const task = makeTask({
      columnId: columns.review.id,
      checklist: { total: 3, done: 3 },
    });

    expect(taskProgress(task, columns.review, [columns.review])).toBe(99);
  });
});

describe("slotFor", () => {
  const first: BoardColumn = { id: "exec-1", phase: "execution", position: "a" };
  const second: BoardColumn = { id: "exec-2", phase: "execution", position: "b" };
  const pair = [first, second];

  it("splits a phase band evenly, in board order", () => {
    expect(slotFor(first, pair)).toStrictEqual({ floor: 30, ceiling: 49.5 });
    expect(slotFor(second, pair)).toStrictEqual({ floor: 49.5, ceiling: 69 });
  });

  it("keeps progress rising left to right across the split", () => {
    const task = makeTask({ checklist: { total: 2, done: 1 } });

    const left = taskProgress(task, first, pair);
    const right = taskProgress(task, second, pair);

    expect(left).toBeLessThan(right);
  });
});

describe("projectProgress", () => {
  it("reports nothing for a project with no tasks", () => {
    expect(projectProgress(makeBoard([]))).toStrictEqual({ raw: 0, adjusted: 0 });
  });

  it("counts blocked work in raw and drops it from adjusted", () => {
    const board = makeBoard([
      makeTask({ id: "a", checklist: { total: 4, done: 4 } }),
      makeTask({ id: "b", blocked: true }),
    ]);

    expect(projectProgress(board)).toStrictEqual({ raw: 49.5, adjusted: 34.5 });
  });

  it("never rounds to 100 while a task sits outside done", () => {
    const board = makeBoard([
      makeTask({ id: "done-1", columnId: columns.done.id }),
      makeTask({
        id: "review-1",
        columnId: columns.review.id,
        checklist: { total: 2, done: 2 },
      }),
    ]);

    expect(projectProgress(board).raw).toBe(99);
  });

  it("reaches 100 only when every task is done", () => {
    const board = makeBoard([
      makeTask({ id: "d1", columnId: columns.done.id }),
      makeTask({ id: "d2", columnId: columns.done.id }),
    ]);

    expect(projectProgress(board)).toStrictEqual({ raw: 100, adjusted: 100 });
  });

  it("ignores soft-deleted tasks", () => {
    const live = makeTask({ id: "live", checklist: { total: 1, done: 1 } });
    const deleted = makeTask({
      id: "gone",
      columnId: columns.planning.id,
      deletedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(projectProgress(makeBoard([live, deleted])).raw).toBe(
      projectProgress(makeBoard([live])).raw,
    );
  });

  it("resolves a task's column from the board", () => {
    const task = makeTask({ columnId: columns.review.id });
    const board = makeBoard([task], allColumns);

    expect(taskProgressIn(task, board)).toBe(70);
  });
});
