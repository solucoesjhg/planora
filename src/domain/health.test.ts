import { describe, expect, it } from "vitest";
import {
  SEED_EPOCH,
  columns,
  dayAfter,
  dayBefore,
  daysAfter,
  daysBefore,
  makeBoard,
  makeTask,
  project,
} from "@/fixtures/board";
import {
  type ActivityWindow,
  type HealthSnapshot,
  bandOf,
  projectHealth,
  smoothVerdict,
  taskWeight,
} from "./health";
import type { Task } from "./types";

const now = SEED_EPOCH;

function activityOf(tasks: readonly Task[], touchedIds: readonly string[] = []): ActivityWindow {
  return {
    touched: new Set(touchedIds),
    openDuringWindow: new Set(tasks.map((task) => task.id)),
  };
}

function tasksWhere(count: number, build: (index: number) => Partial<Task>): Task[] {
  return Array.from({ length: count }, (_, index) =>
    makeTask({ id: `t${index}`, ...build(index) }),
  );
}

describe("health is a share of the work, not a count of problems", () => {
  it("scores the same flow for 2 of 5 blocked and 40 of 100", () => {
    const small = tasksWhere(5, (index) => ({ blocked: index < 2 }));
    const large = tasksWhere(100, (index) => ({ blocked: index < 40 }));

    const smallReport = projectHealth({
      project,
      context: makeBoard(small),
      activity: activityOf(small),
      now,
    });
    const largeReport = projectHealth({
      project,
      context: makeBoard(large),
      activity: activityOf(large),
      now,
    });

    expect(smallReport.dimensions.flow).toBe(60);
    expect(largeReport.dimensions.flow).toBe(60);
  });

  it("weighs a task by priority and by who waits on it", () => {
    const blocker = makeTask({ id: "blocker", priority: "high" });
    const waiting = [
      makeTask({ id: "w1", dependsOn: ["blocker"] }),
      makeTask({ id: "w2", dependsOn: ["blocker"] }),
    ];
    const board = makeBoard([blocker, ...waiting]);

    // high (3) × (1 + 0.5 × 2 direct dependents) = 6
    expect(taskWeight(blocker, board)).toBe(6);
    // medium (2) × (1 + 0) = 2
    expect(taskWeight(waiting[0]!, board)).toBe(2);
  });
});

describe("dimensions that cannot be computed are dropped", () => {
  it("drops pace when the project has no dates", () => {
    const tasks = tasksWhere(4, () => ({}));
    const report = projectHealth({
      project: { startDate: null, dueDate: null, createdAt: daysBefore(30) },
      context: makeBoard(tasks),
      activity: activityOf(tasks, tasks.map((task) => task.id)),
      now,
    });

    expect(report.dimensions.pace).toBeNull();
    expect(report.dimensions.flow).toBe(100);
  });

  it("drops punctuality rather than scoring undated work as punctual", () => {
    const tasks = tasksWhere(4, () => ({ dueDate: null }));
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.dimensions.punctuality).toBeNull();
  });

  it("counts lateness on a ramp, not as a switch", () => {
    const tasks = [
      makeTask({ id: "late", dueDate: dayBefore(7) }),
      makeTask({ id: "soon", dueDate: dayAfter(3) }),
      makeTask({ id: "later", dueDate: dayAfter(9) }),
    ];
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    // One of three equal weights, half-saturated: 100 × (1 − (1/3 × 0.5)).
    expect(report.dimensions.punctuality).toBe(83.3);
  });
});

describe("verdicts at the edges", () => {
  it("calls a project with fewer than three open tasks insufficient data", () => {
    const tasks = tasksWhere(2, () => ({}));
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.verdict).toBe("insufficient_data");
    expect(report.score).toBeNull();
  });

  it("calls a brand-new project insufficient data, not critical", () => {
    const tasks = tasksWhere(4, () => ({ blocked: true }));
    const report = projectHealth({
      project: { ...project, createdAt: daysBefore(1) },
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.verdict).toBe("insufficient_data");
  });

  it("calls a finished project healthy — done is a state, not missing evidence", () => {
    const tasks = tasksWhere(4, () => ({ columnId: columns.done.id }));
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.verdict).toBe("healthy");
    expect(report.score).toBe(100);
  });
});

describe("the ceiling reads the work, not the clock", () => {
  it("keeps a quiet but sound project out of both healthy and critical", () => {
    // Nothing blocked, nothing late, ahead of the calendar — but untouched for
    // three weeks. The old worst-dimension clamp made this critical.
    const tasks = tasksWhere(4, () => ({ enteredColumnAt: daysBefore(21) }));
    const report = projectHealth({
      project: { startDate: dayBefore(10), dueDate: dayAfter(30), createdAt: daysBefore(10) },
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.dimensions.freshness).toBe(0);
    expect(report.dimensions.momentum).toBe(0);
    expect(report.dimensions.flow).toBe(100);
    expect(report.dimensions.pace).toBe(100);
    // (100×.30 + 100×.25 + 0×.15 + 0×.10) / .80 — punctuality dropped.
    expect(report.score).toBe(68.8);
    expect(report.verdict).toBe("at_risk");
  });

  it("stops a blocked project from being called healthy", () => {
    const tasks = tasksWhere(5, (index) => ({ blocked: index < 2 }));
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks, tasks.map((task) => task.id)),
      now,
    });

    expect(report.dimensions.flow).toBe(60);
    expect(report.score).toBeLessThanOrEqual(84);
    expect(report.verdict).not.toBe("healthy");
  });
});

describe("momentum", () => {
  it("does not fall when a task is completed", () => {
    const open = tasksWhere(4, () => ({}));
    const before = projectHealth({
      project,
      context: makeBoard(open),
      activity: activityOf(open),
      now,
    });

    const completed = makeTask({ ...open[3]!, columnId: columns.done.id });
    const after = projectHealth({
      project,
      context: makeBoard([...open.slice(0, 3), completed]),
      // The completed task stays in the window it was open during.
      activity: { touched: new Set([completed.id]), openDuringWindow: new Set(open.map((t) => t.id)) },
      now,
    });

    expect(before.dimensions.momentum).toBe(0);
    expect(after.dimensions.momentum!).toBeGreaterThanOrEqual(
      before.dimensions.momentum!,
    );
  });
});

describe("findings", () => {
  it("names the task behind a task signal and the project behind a project one", () => {
    const tasks = [
      makeTask({ id: "stuck", blocked: true, priority: "high" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" }),
      makeTask({ id: "d" }),
    ];
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.bottlenecks[0]).toStrictEqual({
      scope: "task",
      taskId: "stuck",
      signal: "blocked",
      weight: 3,
    });
    expect(report.findings.some((f) => f.scope === "project" && f.signal === "momentum")).toBe(true);
  });

  it("deduplicates the top two by reason", () => {
    const tasks = [
      makeTask({ id: "b1", blocked: true, priority: "high" }),
      makeTask({ id: "b2", blocked: true, priority: "high" }),
      makeTask({ id: "late", dueDate: dayBefore(30) }),
      makeTask({ id: "d" }),
    ];
    const report = projectHealth({
      project,
      context: makeBoard(tasks),
      activity: activityOf(tasks),
      now,
    });

    expect(report.topTwo.map((finding) => finding.signal)).toStrictEqual([
      "blocked",
      "late",
    ]);
  });
});

describe("hysteresis", () => {
  const previous = (verdict: HealthSnapshot["verdict"], rawVerdict: HealthSnapshot["rawVerdict"], score: number): HealthSnapshot => ({ verdict, rawVerdict, score });

  it("holds the verdict while a score oscillates around a boundary", () => {
    expect(smoothVerdict(bandOf(83), 83, previous("healthy", "healthy", 86))).toBe(
      "healthy",
    );
  });

  it("gives way on the second consecutive evaluation across the line", () => {
    expect(smoothVerdict(bandOf(83), 83, previous("healthy", "attention", 83))).toBe(
      "attention",
    );
  });

  it("gives way at once when the score clears the boundary by the margin", () => {
    expect(smoothVerdict(bandOf(81), 81, previous("healthy", "healthy", 86))).toBe(
      "attention",
    );
  });

  it("moves two bands when the score moves two bands", () => {
    expect(smoothVerdict(bandOf(40), 40, previous("healthy", "healthy", 86))).toBe(
      "critical",
    );
  });

  it("adopts the band directly on a first evaluation", () => {
    expect(smoothVerdict(bandOf(72), 72, null)).toBe("attention");
  });
});
