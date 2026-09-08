import { describe, expect, it } from "vitest";
import { columns, makeBoard, makeTask } from "@/fixtures/board";
import { isRefused } from "@/lib/result";
import {
  blockingRoots,
  canAddDependency,
  isBlocked,
  unresolvedDependencies,
} from "./dependencies";

describe("isBlocked", () => {
  it("is true for the manual flag", () => {
    const task = makeTask({ id: "a", blocked: true });
    expect(isBlocked(task, makeBoard([task]))).toBe(true);
  });

  it("is true while a dependency is not done", () => {
    const blocker = makeTask({ id: "blocker" });
    const waiting = makeTask({ id: "waiting", dependsOn: ["blocker"] });

    expect(isBlocked(waiting, makeBoard([blocker, waiting]))).toBe(true);
  });

  it("is false once the dependency reaches done", () => {
    const blocker = makeTask({ id: "blocker", columnId: columns.done.id });
    const waiting = makeTask({ id: "waiting", dependsOn: ["blocker"] });

    expect(isBlocked(waiting, makeBoard([blocker, waiting]))).toBe(false);
  });

  it("never calls a done task blocked", () => {
    const task = makeTask({
      id: "finished",
      columnId: columns.done.id,
      blocked: true,
    });

    expect(isBlocked(task, makeBoard([task]))).toBe(false);
  });

  it("ignores a deleted dependency", () => {
    const blocker = makeTask({ id: "blocker", deletedAt: new Date() });
    const waiting = makeTask({ id: "waiting", dependsOn: ["blocker"] });

    expect(unresolvedDependencies(waiting, makeBoard([blocker, waiting]))).toHaveLength(0);
  });
});

describe("blockingRoots", () => {
  it("reports the end of the chain, not the nearest link", () => {
    const root = makeTask({ id: "root" });
    const middle = makeTask({ id: "middle", dependsOn: ["root"] });
    const leaf = makeTask({ id: "leaf", dependsOn: ["middle"] });
    const board = makeBoard([root, middle, leaf]);

    expect(blockingRoots(leaf, board).map((task) => task.id)).toStrictEqual([
      "root",
    ]);
  });

  it("treats a manually blocked task as its own root", () => {
    const task = makeTask({ id: "stuck", blocked: true });

    expect(blockingRoots(task, makeBoard([task])).map((t) => t.id)).toStrictEqual(
      ["stuck"],
    );
  });
});

describe("canAddDependency", () => {
  it("rejects a cycle before it is written, and names the path", () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b", dependsOn: ["a"] });
    const board = makeBoard([a, b]);

    // a depending on b would close a -> b -> a.
    const decision = canAddDependency("a", "b", board);

    expect(isRefused(decision)).toBe(true);
    if (!isRefused(decision)) return;
    expect(decision.reason).toBe("cycle");
    expect(decision.detail).toBe("a -> b -> a");
  });

  it("rejects a task depending on itself", () => {
    const a = makeTask({ id: "a" });
    const decision = canAddDependency("a", "a", makeBoard([a]));

    expect(isRefused(decision) && decision.reason).toBe("self");
  });

  it("rejects an edge that already exists", () => {
    const a = makeTask({ id: "a", dependsOn: ["b"] });
    const b = makeTask({ id: "b" });
    const decision = canAddDependency("a", "b", makeBoard([a, b]));

    expect(isRefused(decision) && decision.reason).toBe("duplicate");
  });

  it("allows an edge that keeps the graph acyclic", () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b" });

    expect(isRefused(canAddDependency("a", "b", makeBoard([a, b])))).toBe(false);
  });
});
