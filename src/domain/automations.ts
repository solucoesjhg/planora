/**
 * The rule engine (DEVELOPMENT_PLAN.md §7 Phase 9).
 *
 * `when <event> · if <condition> · then <action>`. This module decides — it
 * never performs. Given a rule, an event and what is known about the event's
 * subject, it answers "fire these actions" or "skip, and here is why". The
 * service that runs actions, records runs and keeps the log lives in
 * `server/modules/automations`.
 *
 * Two guards keep automation from becoming noise (§9): a rule fires at most
 * MAX_ACTIONS_PER_EVENT actions for one event, and an event that is itself
 * the consequence of an automation carries its causal depth — past
 * MAX_CAUSATION_DEPTH nothing fires, so a rule that triggers a rule cannot
 * run away.
 */

import type { Verdict } from "./health";
import type { CalendarDate, Phase, Priority } from "./types";
import { calendarDaysBetween } from "./types";

/** What a rule can wait for: board events, and the routines the clock emits. */
export const TRIGGERS = [
  "task.created",
  "task.moved",
  "task.completed",
  "task.blocked",
  "task.unblocked",
  "task.assigned",
  "comment.added",
  "dependency.resolved",
  "task.due_soon",
  "task.overdue",
  "task.stalled",
  "project.health_changed",
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const CONDITION_FIELDS = [
  "priority",
  "phase",
  "to_phase",
  "blocked",
  "assigned",
  "due_within_days",
  "verdict",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export type Condition =
  | { readonly field: "priority"; readonly op: "is" | "is_not"; readonly value: Priority }
  | { readonly field: "phase"; readonly op: "is" | "is_not"; readonly value: Phase }
  | { readonly field: "to_phase"; readonly op: "is" | "is_not"; readonly value: Phase }
  | { readonly field: "blocked"; readonly op: "is"; readonly value: boolean }
  | { readonly field: "assigned"; readonly op: "is"; readonly value: boolean }
  | { readonly field: "due_within_days"; readonly op: "lte"; readonly value: number }
  | { readonly field: "verdict"; readonly op: "is" | "is_not"; readonly value: Verdict };

export const ACTION_TYPES = [
  "assign",
  "move",
  "comment",
  "create_subtask",
  "set_priority",
  "notify",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type Action =
  | { readonly type: "assign"; readonly userId: string }
  | { readonly type: "move"; readonly phase: Phase }
  | { readonly type: "comment"; readonly body: string }
  | { readonly type: "create_subtask"; readonly title: string }
  | { readonly type: "set_priority"; readonly priority: Priority }
  | {
      readonly type: "notify";
      readonly to: "assignees" | "managers" | "user";
      readonly userId?: string;
      readonly message: string;
    };

export type Rule = {
  readonly trigger: Trigger;
  readonly conditions: readonly Condition[];
  readonly actions: readonly Action[];
};

/** What the engine may ask about the event's subject. Absent means unknown. */
export type Subject = {
  readonly task?: {
    readonly priority: Priority;
    readonly phase: Phase;
    readonly blocked: boolean;
    readonly assigneeIds: readonly string[];
    readonly dueDate: CalendarDate | null;
  };
  /** For `task.moved`: where the card went. */
  readonly toPhase?: Phase;
  /** For `project.health_changed`: the new verdict. */
  readonly verdict?: Verdict;
};

export type RuleEvent = {
  readonly type: string;
  /** How many automations stand between this event and a person's act. */
  readonly depth: number;
};

export const MAX_ACTIONS_PER_EVENT = 10;
export const MAX_CAUSATION_DEPTH = 3;

export type SkipReason = "disabled" | "trigger" | "loop" | "condition";

export type Verdict9 =
  | { readonly kind: "fire"; readonly actions: readonly Action[] }
  | { readonly kind: "skip"; readonly reason: SkipReason; readonly detail?: string };

export function evaluateRule(
  rule: Rule & { readonly enabled?: boolean },
  event: RuleEvent,
  subject: Subject,
  today: CalendarDate,
): Verdict9 {
  if (rule.enabled === false) return { kind: "skip", reason: "disabled" };
  if (rule.trigger !== event.type) return { kind: "skip", reason: "trigger" };
  if (event.depth >= MAX_CAUSATION_DEPTH) {
    return { kind: "skip", reason: "loop", detail: `depth ${event.depth}` };
  }

  for (const condition of rule.conditions) {
    const outcome = holds(condition, subject, today);
    if (outcome !== true) {
      return { kind: "skip", reason: "condition", detail: describeCondition(condition) };
    }
  }

  return { kind: "fire", actions: rule.actions.slice(0, MAX_ACTIONS_PER_EVENT) };
}

/** True when the condition holds; false when it does not or cannot be told. */
export function holds(condition: Condition, subject: Subject, today: CalendarDate): boolean {
  switch (condition.field) {
    case "priority":
      return compare(condition.op, subject.task?.priority, condition.value);
    case "phase":
      return compare(condition.op, subject.task?.phase, condition.value);
    case "to_phase":
      return compare(condition.op, subject.toPhase, condition.value);
    case "blocked":
      return subject.task !== undefined && subject.task.blocked === condition.value;
    case "assigned":
      return (
        subject.task !== undefined && subject.task.assigneeIds.length > 0 === condition.value
      );
    case "due_within_days": {
      const due = subject.task?.dueDate;
      if (!due) return false;
      const days = calendarDaysBetween(today, due);
      return days >= 0 && days <= condition.value;
    }
    case "verdict":
      return compare(condition.op, subject.verdict, condition.value);
  }
}

function compare(op: "is" | "is_not", actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  return op === "is" ? actual === expected : actual !== expected;
}

export function describeCondition(condition: Condition): string {
  return `${condition.field} ${condition.op} ${String(condition.value)}`;
}

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

export type RuleProblem =
  | "unknown-trigger"
  | "no-actions"
  | "too-many-actions"
  | "empty-action"
  | "unknown-action";

/** What is wrong with a rule as written, or nothing. The interface asks first. */
export function validateRule(rule: Rule): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (!TRIGGERS.includes(rule.trigger)) problems.push("unknown-trigger");
  if (rule.actions.length === 0) problems.push("no-actions");
  if (rule.actions.length > MAX_ACTIONS_PER_EVENT) problems.push("too-many-actions");

  for (const action of rule.actions) {
    if (!ACTION_TYPES.includes(action.type)) {
      problems.push("unknown-action");
      continue;
    }
    const text =
      action.type === "comment"
        ? action.body
        : action.type === "create_subtask"
          ? action.title
          : action.type === "notify"
            ? action.message
            : action.type === "assign"
              ? action.userId
              : "ok";
    if (text.trim().length === 0) problems.push("empty-action");
  }

  return [...new Set(problems)];
}
