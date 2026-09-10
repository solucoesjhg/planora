import { describe, expect, it } from "vitest";
import { columns, makeBoard, makeTask } from "@/fixtures/board";
import { isRefused } from "@/lib/result";
import { canCompleteProject, deadlineStatus, openTaskCount } from "./projects";

describe("canCompleteProject", () => {
  it("refuses while any task is blocked, and names them", () => {
    const board = makeBoard([
      makeTask({ id: "a", columnId: columns.done.id }),
      makeTask({ id: "stuck", blocked: true }),
    ]);

    const decision = canCompleteProject(board);

    expect(isRefused(decision) && decision.reason).toBe("blocked-tasks");
    expect(isRefused(decision) && decision.detail).toBe("stuck");
  });

  it("counts an open task waiting on an unfinished dependency as blocked", () => {
    const blocker = makeTask({ id: "blocker" });
    const waiting = makeTask({ id: "waiting", dependsOn: ["blocker"] });

    const decision = canCompleteProject(makeBoard([blocker, waiting]));

    expect(isRefused(decision) && decision.reason).toBe("blocked-tasks");
    expect(isRefused(decision) && decision.detail).toBe("waiting");
  });

  it("does not call a finished task blocked, whatever it depended on", () => {
    // Entering done already required the dependency to be resolved (§3.6), and
    // a done task is never blocked (§3.4) — so this project only has open work.
    const blocker = makeTask({ id: "blocker" });
    const finished = makeTask({
      id: "finished",
      columnId: columns.done.id,
      dependsOn: ["blocker"],
    });

    const decision = canCompleteProject(makeBoard([blocker, finished]));
    expect(isRefused(decision) && decision.reason).toBe("open-work");
  });

  it("asks before finishing a project with open work, and accepts the answer", () => {
    const board = makeBoard([
      makeTask({ id: "done", columnId: columns.done.id }),
      makeTask({ id: "open" }),
    ]);

    const asked = canCompleteProject(board);
    expect(isRefused(asked) && asked.reason).toBe("open-work");
    expect(isRefused(asked) && asked.detail).toBe("1");

    expect(isRefused(canCompleteProject(board, "open-work"))).toBe(false);
  });

  it("does not let that acknowledgement cover a blocked task", () => {
    const board = makeBoard([makeTask({ id: "stuck", blocked: true })]);

    expect(isRefused(canCompleteProject(board, "open-work"))).toBe(true);
  });

  it("allows a project whose work is all done", () => {
    const board = makeBoard([
      makeTask({ id: "a", columnId: columns.done.id }),
      makeTask({ id: "b", columnId: columns.done.id }),
    ]);

    expect(isRefused(canCompleteProject(board))).toBe(false);
  });

  it("allows an empty project — there is nothing to leave unfinished", () => {
    expect(isRefused(canCompleteProject(makeBoard([])))).toBe(false);
  });
});

describe("deadlineStatus", () => {
  const now = new Date(2026, 8, 9, 15, 30);

  it("says nothing when there is no date", () => {
    expect(deadlineStatus(null, now)).toStrictEqual({ kind: "none" });
  });

  it("counts whole days, from the start of today", () => {
    expect(deadlineStatus(new Date(2026, 8, 12, 1), now)).toStrictEqual({
      kind: "on-track",
      days: 3,
    });
    expect(deadlineStatus(new Date(2026, 8, 4, 23), now)).toStrictEqual({
      kind: "late",
      days: 5,
    });
  });

  it("treats today as its own state, not as one day late", () => {
    expect(deadlineStatus(new Date(2026, 8, 9, 1), now)).toStrictEqual({
      kind: "due-today",
    });
    expect(deadlineStatus(new Date(2026, 8, 9, 23), now)).toStrictEqual({
      kind: "due-today",
    });
  });
});

describe("openTaskCount", () => {
  it("counts what is left, ignoring done and deleted", () => {
    const board = makeBoard([
      makeTask({ id: "a" }),
      makeTask({ id: "b", columnId: columns.done.id }),
      makeTask({ id: "c", deletedAt: new Date() }),
    ]);

    expect(openTaskCount(board)).toBe(1);
  });
});
