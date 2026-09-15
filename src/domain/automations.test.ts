import { describe, expect, it } from "vitest";
import { dayAfter } from "@/fixtures/board";
import {
  MAX_ACTIONS_PER_EVENT,
  MAX_CAUSATION_DEPTH,
  evaluateRule,
  validateRule,
  type Action,
  type Rule,
  type Subject,
} from "./automations";

const today = dayAfter(0);

const task: NonNullable<Subject["task"]> = {
  priority: "medium",
  phase: "execution",
  blocked: false,
  assigneeIds: [],
  dueDate: dayAfter(1),
};

const comment: Action = { type: "comment", body: "Chegou na execução." };

const rule: Rule = {
  trigger: "task.moved",
  conditions: [{ field: "to_phase", op: "is", value: "execution" }],
  actions: [comment],
};

describe("a rule decides, and does not perform", () => {
  it("fires when the trigger and every condition hold", () => {
    const verdict = evaluateRule(
      rule,
      { type: "task.moved", depth: 0 },
      { task, toPhase: "execution" },
      today,
    );
    expect(verdict).toEqual({ kind: "fire", actions: [comment] });
  });

  it("skips another event, a failed condition, and a disabled rule — each with its reason", () => {
    expect(
      evaluateRule(rule, { type: "comment.added", depth: 0 }, { task }, today),
    ).toMatchObject({ kind: "skip", reason: "trigger" });

    expect(
      evaluateRule(rule, { type: "task.moved", depth: 0 }, { task, toPhase: "review" }, today),
    ).toMatchObject({ kind: "skip", reason: "condition", detail: "to_phase is execution" });

    expect(
      evaluateRule(
        { ...rule, enabled: false },
        { type: "task.moved", depth: 0 },
        { task, toPhase: "execution" },
        today,
      ),
    ).toMatchObject({ kind: "skip", reason: "disabled" });
  });

  it("cannot tell about a subject it was not given, and treats that as not holding", () => {
    const needsTask: Rule = {
      trigger: "project.health_changed",
      conditions: [{ field: "priority", op: "is", value: "high" }],
      actions: [comment],
    };
    expect(
      evaluateRule(needsTask, { type: "project.health_changed", depth: 0 }, { verdict: "critical" }, today),
    ).toMatchObject({ kind: "skip", reason: "condition" });
  });

  it("reads every kind of condition", () => {
    const at = (conditions: Rule["conditions"], subject: Subject) =>
      evaluateRule({ trigger: "task.created", conditions, actions: [comment] }, { type: "task.created", depth: 0 }, subject, today).kind;

    expect(at([{ field: "priority", op: "is_not", value: "high" }], { task })).toBe("fire");
    expect(at([{ field: "phase", op: "is", value: "review" }], { task })).toBe("skip");
    expect(at([{ field: "blocked", op: "is", value: false }], { task })).toBe("fire");
    expect(at([{ field: "assigned", op: "is", value: true }], { task })).toBe("skip");
    expect(at([{ field: "assigned", op: "is", value: true }], { task: { ...task, assigneeIds: ["u"] } })).toBe("fire");
    expect(at([{ field: "due_within_days", op: "lte", value: 2 }], { task })).toBe("fire");
    expect(at([{ field: "due_within_days", op: "lte", value: 0 }], { task })).toBe("skip");
    expect(at([{ field: "due_within_days", op: "lte", value: 2 }], { task: { ...task, dueDate: null } })).toBe("skip");
    expect(at([{ field: "verdict", op: "is", value: "critical" }], { verdict: "critical" })).toBe("fire");
  });
});

describe("automation cannot run away", () => {
  it("fires at most ten actions for one event", () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      type: "comment" as const,
      body: `#${index}`,
    }));
    const verdict = evaluateRule(
      { trigger: "task.created", conditions: [], actions: many },
      { type: "task.created", depth: 0 },
      { task },
      today,
    );
    expect(verdict.kind).toBe("fire");
    if (verdict.kind === "fire") expect(verdict.actions).toHaveLength(MAX_ACTIONS_PER_EVENT);
  });

  it("refuses an event that is already the consequence of too many automations", () => {
    const chain = { trigger: "comment.added" as const, conditions: [], actions: [comment] };
    expect(evaluateRule(chain, { type: "comment.added", depth: MAX_CAUSATION_DEPTH - 1 }, { task }, today).kind).toBe("fire");
    expect(
      evaluateRule(chain, { type: "comment.added", depth: MAX_CAUSATION_DEPTH }, { task }, today),
    ).toMatchObject({ kind: "skip", reason: "loop" });
  });
});

describe("a rule as written", () => {
  it("names what is wrong with it", () => {
    expect(validateRule(rule)).toEqual([]);
    expect(validateRule({ ...rule, actions: [] })).toEqual(["no-actions"]);
    expect(
      validateRule({ ...rule, actions: Array.from({ length: 11 }, () => comment) }),
    ).toEqual(["too-many-actions"]);
    expect(validateRule({ ...rule, actions: [{ type: "comment", body: "  " }] })).toEqual([
      "empty-action",
    ]);
    expect(
      validateRule({ ...rule, trigger: "task.exploded" as Rule["trigger"] }),
    ).toEqual(["unknown-trigger"]);
  });
});
