import { describe, expect, it } from "vitest";
import { columns, makeBoard, makeTask } from "@/fixtures/board";
import { isRefused } from "@/lib/result";
import {
  canEditColumn,
  canMoveTask,
  keyBetween,
  needsRebalance,
  rebalance,
} from "./kanban";
import type { Task } from "./types";

function move(task: Task, ack?: "checklist") {
  return canMoveTask({
    task,
    from: columns.execution,
    to: columns.done,
    context: makeBoard([task]),
    ack,
  });
}

describe("canMoveTask", () => {
  it("refuses a blocked task, naming the block", () => {
    const decision = move(makeTask({ id: "a", blocked: true }));

    expect(isRefused(decision) && decision.reason).toBe("blocked");
  });

  it("refuses unresolved dependencies apart from the block flag", () => {
    const blocker = makeTask({ id: "blocker" });
    const task = makeTask({ id: "waiting", dependsOn: ["blocker"] });
    const decision = canMoveTask({
      task,
      from: columns.execution,
      to: columns.done,
      context: makeBoard([blocker, task]),
    });

    expect(isRefused(decision) && decision.reason).toBe("dependencies");
    expect(isRefused(decision) && decision.detail).toBe("blocker");
  });

  it("refuses an open checklist, and accepts the acknowledged retry", () => {
    const task = makeTask({ id: "a", checklist: { total: 3, done: 1 } });
    const refusal = move(task);

    expect(isRefused(refusal) && refusal.reason).toBe("checklist");
    expect(isRefused(refusal) && refusal.detail).toBe("1/3");
    expect(isRefused(move(task, "checklist"))).toBe(false);
  });

  it("does not let an acknowledgement override a block", () => {
    const task = makeTask({
      id: "a",
      blocked: true,
      checklist: { total: 1, done: 0 },
    });
    const decision = move(task, "checklist");

    expect(isRefused(decision) && decision.reason).toBe("blocked");
  });

  it("leaves moves that are not into done alone", () => {
    const task = makeTask({ id: "a", blocked: true, checklist: { total: 2, done: 0 } });
    const decision = canMoveTask({
      task,
      from: columns.planning,
      to: columns.execution,
      context: makeBoard([task]),
    });

    expect(isRefused(decision)).toBe(false);
  });
});

describe("canEditColumn", () => {
  it("refuses deleting or reordering planning and done", () => {
    expect(isRefused(canEditColumn(columns.planning, "delete"))).toBe(true);
    expect(isRefused(canEditColumn(columns.done, "reorder"))).toBe(true);
    expect(isRefused(canEditColumn(columns.done, "rephase"))).toBe(true);
  });

  it("allows renaming them, and anything on a middle column", () => {
    expect(isRefused(canEditColumn(columns.planning, "rename"))).toBe(false);
    expect(isRefused(canEditColumn(columns.execution, "delete"))).toBe(false);
  });
});

describe("ordering keys", () => {
  it("orders a fresh list", () => {
    const first = keyBetween(null, null);
    const second = keyBetween(first, null);

    expect(first < second).toBe(true);
  });

  it("puts a midpoint strictly between its neighbours", () => {
    const first = keyBetween(null, null);
    const third = keyBetween(first, null);
    const second = keyBetween(first, third);

    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });

  it("survives repeated insertion in the same gap", () => {
    let lower = keyBetween(null, null);
    const upper = keyBetween(lower, null);
    const seen = new Set<string>();

    for (let index = 0; index < 40; index += 1) {
      const next = keyBetween(lower, upper);
      expect(lower < next && next < upper).toBe(true);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      lower = next;
    }
  });

  it("refuses a reversed pair rather than writing a broken key", () => {
    expect(() => keyBetween("b", "a")).toThrow();
  });

  it("rebalances on length, since text keys never run out of room", () => {
    expect(needsRebalance(["V", "l"])).toBe(false);
    expect(needsRebalance(["V".repeat(33)])).toBe(true);

    const keys = rebalance(5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toStrictEqual(keys);
  });
});
