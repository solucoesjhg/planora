/**
 * The shapes the domain reasons about (DEVELOPMENT_PLAN.md §3).
 *
 * These are not database rows. A repository maps rows onto them, and the
 * engine never learns where they came from.
 */

export const PHASES = ["planning", "execution", "review", "done"] as const;
export type Phase = (typeof PHASES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type BoardColumn = {
  readonly id: string;
  readonly phase: Phase;
  /** Fractional index; board order is this, then id as tie-break. */
  readonly position: string;
};

/**
 * A day on a calendar, not an instant — `YYYY-MM-DD`.
 *
 * A due date has no time and no time zone: "15 de setembro" is the same day in
 * São Paulo and in Lisbon. Turning it into a `Date` picks a moment (midnight
 * UTC), and reading that moment back in any zone west of UTC lands on the day
 * before, which is how every deadline came to be shown one day early.
 */
export type CalendarDate = string;

const pad = (value: number) => String(value).padStart(2, "0");

/** The day this instant falls on, where the reader is. */
export function calendarDateOf(instant: Date): CalendarDate {
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

/** Whole days from one calendar day to another; negative when `to` is earlier. */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
}

export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(utcOf(value));
}

/** Both ends anchored at the same hour, so the difference is exact days. */
function utcOf(date: CalendarDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export type Checklist = {
  readonly total: number;
  readonly done: number;
};

export type Task = {
  readonly id: string;
  readonly columnId: string;
  readonly priority: Priority;
  readonly checklist: Checklist;
  /** The manual flag only. The union with dependencies is `isBlocked()`. */
  readonly blocked: boolean;
  readonly dependsOn: readonly string[];
  readonly dueDate: CalendarDate | null;
  /** When the task landed in its current column; falls back to creation. */
  readonly enteredColumnAt: Date;
  readonly deletedAt: Date | null;
};

export type Project = {
  readonly startDate: CalendarDate | null;
  readonly dueDate: CalendarDate | null;
  /** An instant: when the row was written, not a day somebody chose. */
  readonly createdAt: Date;
};

/** Everything a rule needs to answer a question about one project. */
export type BoardContext = {
  readonly columns: readonly BoardColumn[];
  readonly tasks: readonly Task[];
};

export const DAY_MS = 86_400_000;

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/** One decimal internally; display rounding is the caller's business (§3.4). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function toDisplay(value: number): number {
  return Math.round(value);
}

export function liveTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.deletedAt === null);
}

export function columnById(
  context: BoardContext,
  columnId: string,
): BoardColumn | undefined {
  return context.columns.find((column) => column.id === columnId);
}

export function taskById(
  context: BoardContext,
  taskId: string,
): Task | undefined {
  return context.tasks.find((task) => task.id === taskId);
}

/** Board order: fractional index first, id as the deterministic tie-break. */
export function byBoardOrder(a: BoardColumn, b: BoardColumn): number {
  if (a.position === b.position) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.position < b.position ? -1 : 1;
}

export function columnsInPhase(
  context: BoardContext,
  phase: Phase,
): BoardColumn[] {
  return context.columns
    .filter((column) => column.phase === phase)
    .sort(byBoardOrder);
}

/**
 * A task whose column is missing is treated as planning: the engine reports a
 * number rather than throwing at a repository's inconsistency.
 */
export function phaseOf(task: Task, context: BoardContext): Phase {
  return columnById(context, task.columnId)?.phase ?? "planning";
}

export function isDone(task: Task, context: BoardContext): boolean {
  return phaseOf(task, context) === "done";
}
