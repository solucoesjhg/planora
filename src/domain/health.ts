/**
 * The health engine (DEVELOPMENT_PLAN.md §3.5).
 *
 * Five normalized dimensions, weighted, with a ceiling read from the two that
 * describe the work itself. No dimension counts problems — three are shares of
 * affected work over open work, and the other two are ratios against the
 * calendar and against recent activity, so project size cancels out.
 */

import { isBlocked } from "./dependencies";
import { projectProgress } from "./progress";
import {
  type BoardContext,
  type Phase,
  type Priority,
  type Project,
  type Task,
  calendarDateOf,
  calendarDaysBetween,
  daysBetween,
  isDone,
  liveTasks,
  phaseOf,
  round1,
} from "./types";

export type Verdict =
  | "healthy"
  | "attention"
  | "at_risk"
  | "critical"
  | "insufficient_data";

export type DimensionName =
  | "flow"
  | "pace"
  | "punctuality"
  | "freshness"
  | "momentum";

export type Dimensions = Record<DimensionName, number | null>;

export type TaskSignal = "blocked" | "late" | "stale";
export type ProjectSignal = "pace" | "momentum";

export type TaskFinding = {
  readonly scope: "task";
  readonly taskId: string;
  readonly signal: TaskSignal;
  /** What this task contributed to its dimension. */
  readonly weight: number;
};

export type ProjectFinding = {
  readonly scope: "project";
  readonly signal: ProjectSignal;
  readonly detail: string;
};

export type Finding = TaskFinding | ProjectFinding;

/** What the service reads back from the last snapshot, for hysteresis. */
export type HealthSnapshot = {
  readonly verdict: Verdict;
  /** The band the score fell into before smoothing. */
  readonly rawVerdict: Verdict;
  readonly score: number | null;
};

/**
 * Activity over the last seven days, supplied by the service — the engine
 * stays pure and never reads the event stream itself. `openDuringWindow`
 * includes tasks completed inside the window, so finishing work cannot lower
 * momentum.
 */
export type ActivityWindow = {
  readonly touched: ReadonlySet<string>;
  readonly openDuringWindow: ReadonlySet<string>;
};

export type HealthInput = {
  readonly project: Project;
  readonly context: BoardContext;
  readonly activity: ActivityWindow;
  readonly now: Date;
  readonly previous?: HealthSnapshot | null;
};

export type HealthReport = {
  readonly verdict: Verdict;
  readonly rawVerdict: Verdict;
  readonly score: number | null;
  readonly dimensions: Dimensions;
  readonly findings: readonly Finding[];
  readonly bottlenecks: readonly TaskFinding[];
  readonly topTwo: readonly TaskFinding[];
};

export const DIMENSION_WEIGHTS: Record<DimensionName, number> = {
  flow: 0.3,
  pace: 0.25,
  punctuality: 0.2,
  freshness: 0.15,
  momentum: 0.1,
};

export const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Two weeks in planning is normal; two weeks in review is a problem. */
export const STALE_THRESHOLD_DAYS: Record<Phase, number> = {
  planning: 14,
  execution: 7,
  review: 5,
  done: Number.POSITIVE_INFINITY,
};

export const LATE_SATURATION_DAYS = 14;
export const MOMENTUM_BASELINE = 0.2;
export const MIN_OPEN_TASKS = 3;
export const MIN_PROJECT_AGE_DAYS = 3;
export const HYSTERESIS_MARGIN = 3;
export const MAX_DEPENDENTS_COUNTED = 3;

const BAND_FLOOR: Record<Exclude<Verdict, "insufficient_data">, number> = {
  healthy: 85,
  attention: 70,
  at_risk: 50,
  critical: 0,
};

const BAND_ORDER = ["healthy", "attention", "at_risk", "critical"] as const;

const EMPTY_DIMENSIONS: Dimensions = {
  flow: null,
  pace: null,
  punctuality: null,
  freshness: null,
  momentum: null,
};

/**
 * Weight of one task. A blocked task three others wait on is not the same
 * event as a blocked task nobody needs — but only *direct* dependents count:
 * blocking propagates, weight does not, or one stuck task at the head of a
 * chain would dominate every dimension.
 */
export function taskWeight(task: Task, context: BoardContext): number {
  const dependents = context.tasks.filter(
    (candidate) =>
      candidate.deletedAt === null && candidate.dependsOn.includes(task.id),
  ).length;

  return (
    PRIORITY_WEIGHTS[task.priority] *
    (1 + 0.5 * Math.min(dependents, MAX_DEPENDENTS_COUNTED))
  );
}

export function projectHealth(input: HealthInput): HealthReport {
  const { context, project, activity, now, previous = null } = input;

  const tasks = liveTasks(context.tasks);
  const open = tasks.filter((task) => !isDone(task, context));

  // Finished is a state, not a lack of evidence.
  if (tasks.length > 0 && open.length === 0) {
    return settle("healthy", 100, EMPTY_DIMENSIONS, [], previous);
  }

  const ageDays = daysBetween(project.createdAt, now);
  if (open.length < MIN_OPEN_TASKS || ageDays < MIN_PROJECT_AGE_DAYS) {
    return {
      verdict: "insufficient_data",
      rawVerdict: "insufficient_data",
      score: null,
      dimensions: EMPTY_DIMENSIONS,
      findings: [],
      bottlenecks: [],
      topTwo: [],
    };
  }

  const findings: Finding[] = [];
  const weights = new Map<string, number>(
    open.map((task) => [task.id, taskWeight(task, context)]),
  );
  const weightOf = (task: Task) => weights.get(task.id) ?? 0;
  const openWeight = open.reduce((total, task) => total + weightOf(task), 0);

  // --- Flow ---------------------------------------------------------
  let blockedWeight = 0;
  for (const task of open) {
    if (!isBlocked(task, context)) continue;
    blockedWeight += weightOf(task);
    findings.push({
      scope: "task",
      taskId: task.id,
      signal: "blocked",
      weight: round1(weightOf(task)),
    });
  }
  const flow = share(blockedWeight, openWeight);

  // --- Punctuality --------------------------------------------------
  let datedWeight = 0;
  let lateWeight = 0;
  for (const task of open) {
    if (task.dueDate === null) continue;
    datedWeight += weightOf(task);

    // Whole days between two calendar days: a task due today is not late.
    const daysLate = calendarDaysBetween(task.dueDate, calendarDateOf(now));
    const factor = clamp01(daysLate / LATE_SATURATION_DAYS);
    if (factor <= 0) continue;

    lateWeight += weightOf(task) * factor;
    findings.push({
      scope: "task",
      taskId: task.id,
      signal: "late",
      weight: round1(weightOf(task) * factor),
    });
  }
  const punctuality = share(lateWeight, datedWeight);

  // --- Freshness ----------------------------------------------------
  let staleWeight = 0;
  for (const task of open) {
    const threshold = STALE_THRESHOLD_DAYS[phaseOf(task, context)];
    const days = daysBetween(task.enteredColumnAt, now);
    const factor = clamp01((days - threshold) / threshold);
    if (factor <= 0) continue;

    staleWeight += weightOf(task) * factor;
    findings.push({
      scope: "task",
      taskId: task.id,
      signal: "stale",
      weight: round1(weightOf(task) * factor),
    });
  }
  const freshness = share(staleWeight, openWeight);

  // --- Pace ---------------------------------------------------------
  const pace = paceOf(project, context, now);
  if (pace !== null && pace < 100) {
    findings.push({
      scope: "project",
      signal: "pace",
      detail: "progress is behind the calendar",
    });
  }

  // --- Momentum -----------------------------------------------------
  const momentum = momentumOf(activity);
  if (momentum !== null && momentum < 100) {
    findings.push({
      scope: "project",
      signal: "momentum",
      detail: "little movement in the last seven days",
    });
  }

  const dimensions: Dimensions = { flow, pace, punctuality, freshness, momentum };
  const score = compose(dimensions);
  const rawVerdict = score === null ? "insufficient_data" : bandOf(score);

  return settle(rawVerdict, score, dimensions, findings, previous);
}

function settle(
  rawVerdict: Verdict,
  score: number | null,
  dimensions: Dimensions,
  findings: readonly Finding[],
  previous: HealthSnapshot | null,
): HealthReport {
  const taskFindings = findings
    .filter((finding): finding is TaskFinding => finding.scope === "task")
    .sort(byWeightThenId);

  return {
    verdict:
      score === null ? rawVerdict : smoothVerdict(rawVerdict, score, previous),
    rawVerdict,
    score,
    dimensions,
    findings,
    bottlenecks: taskFindings,
    topTwo: pickTopTwo(taskFindings),
  };
}

/** Higher is better: the share of open work *not* carrying the signal. */
function share(affected: number, total: number): number | null {
  if (total <= 0) return null;
  return round1(100 * (1 - affected / total));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function paceOf(
  project: Project,
  context: BoardContext,
  now: Date,
): number | null {
  const { startDate, dueDate } = project;
  if (startDate === null || dueDate === null) return null;

  const window = calendarDaysBetween(startDate, dueDate);
  if (window <= 0) return null;

  const elapsedShare = Math.min(
    1,
    calendarDaysBetween(startDate, calendarDateOf(now)) / window,
  );
  if (elapsedShare <= 0) return null;

  const expected = elapsedShare * 100;
  const actual = projectProgress(context).raw;
  return round1(100 * Math.min(1, actual / expected));
}

function momentumOf(activity: ActivityWindow): number | null {
  const inWindow = [...activity.openDuringWindow];
  if (inWindow.length === 0) return null;

  const touched = inWindow.filter((id) => activity.touched.has(id)).length;
  const touchedShare = touched / inWindow.length;
  return round1(100 * Math.min(1, touchedShare / MOMENTUM_BASELINE));
}

/**
 * The weighted average, then a ceiling read from Flow and Punctuality only.
 * A ceiling driven by every dimension turns a quiet fortnight into `critical`,
 * because Freshness and Momentum both fall to zero when nobody touches
 * anything — and a maintainer on holiday is not a project in crisis.
 */
function compose(dimensions: Dimensions): number | null {
  let weighted = 0;
  let totalWeight = 0;

  for (const name of Object.keys(DIMENSION_WEIGHTS) as DimensionName[]) {
    const value = dimensions[name];
    if (value === null) continue;
    weighted += value * DIMENSION_WEIGHTS[name];
    totalWeight += DIMENSION_WEIGHTS[name];
  }

  if (totalWeight === 0) return null;
  let score = weighted / totalWeight;

  const guards = [dimensions.flow, dimensions.punctuality].filter(
    (value): value is number => value !== null,
  );
  if (guards.length > 0) {
    const worst = Math.min(...guards);
    if (worst < 25) score = Math.min(score, 49);
    else if (worst < 50) score = Math.min(score, 69);
    else if (worst < 70) score = Math.min(score, 84);
  }

  return round1(score);
}

/** The band a score falls into, before hysteresis smooths it. */
export function bandOf(score: number): Exclude<Verdict, "insufficient_data"> {
  if (score >= BAND_FLOOR.healthy) return "healthy";
  if (score >= BAND_FLOOR.attention) return "attention";
  if (score >= BAND_FLOOR.at_risk) return "at_risk";
  return "critical";
}

function rankOf(verdict: Verdict): number {
  const rank = BAND_ORDER.indexOf(verdict as (typeof BAND_ORDER)[number]);
  return rank < 0 ? BAND_ORDER.length : rank;
}

/**
 * A verdict changes when the score crosses the boundary by at least three
 * points, or when it has stayed across for two consecutive evaluations. The
 * margin guards the boundary being crossed, not the distance travelled, so a
 * score that jumps two bands moves two bands.
 */
export function smoothVerdict(
  rawVerdict: Verdict,
  score: number,
  previous: HealthSnapshot | null,
): Verdict {
  if (!previous || previous.verdict === "insufficient_data") return rawVerdict;
  if (rawVerdict === previous.verdict) return rawVerdict;

  const worsening = rankOf(rawVerdict) > rankOf(previous.verdict);
  const boundary = worsening
    ? floorOf(previous.verdict)
    : floorOf(BAND_ORDER[rankOf(previous.verdict) - 1] ?? "healthy");

  const crossedFar = worsening
    ? score <= boundary - HYSTERESIS_MARGIN
    : score >= boundary + HYSTERESIS_MARGIN;

  if (crossedFar) return rawVerdict;
  if (previous.rawVerdict === rawVerdict) return rawVerdict;
  return previous.verdict;
}

function floorOf(verdict: Verdict): number {
  if (verdict === "insufficient_data") return 0;
  return BAND_FLOOR[verdict];
}

function byWeightThenId(a: TaskFinding, b: TaskFinding): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

/** The two heaviest, deduplicated by reason so one problem is not shown twice. */
function pickTopTwo(findings: readonly TaskFinding[]): TaskFinding[] {
  const chosen: TaskFinding[] = [];
  const usedSignals = new Set<TaskSignal>();

  for (const finding of findings) {
    if (chosen.length === 2) break;
    if (usedSignals.has(finding.signal)) continue;
    usedSignals.add(finding.signal);
    chosen.push(finding);
  }

  for (const finding of findings) {
    if (chosen.length === 2) break;
    if (!chosen.includes(finding)) chosen.push(finding);
  }

  return chosen;
}
