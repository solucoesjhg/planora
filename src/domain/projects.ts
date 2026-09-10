/**
 * Project rules (DEVELOPMENT_PLAN.md §7 Phase 5).
 *
 * Completing a project is a claim about the work inside it, so it is a domain
 * decision rather than a status field the interface flips.
 */

import { type Decision, allowed, refused } from "@/lib/result";
import { isBlocked } from "./dependencies";
import {
  type BoardContext,
  type CalendarDate,
  type Task,
  calendarDateOf,
  calendarDaysBetween,
  isDone,
  liveTasks,
} from "./types";

export type CompletionRefusal = "blocked-tasks" | "open-work";

/**
 * Blocked work is absolute: a project cannot be called finished while any of
 * it is stuck. Merely unfinished work is confirmable — sometimes a project
 * really does end with cards nobody will do, and saying so out loud is better
 * than deleting them to make the button work.
 */
export function canCompleteProject(
  context: BoardContext,
  ack?: CompletionRefusal,
): Decision<CompletionRefusal> {
  const tasks = liveTasks(context.tasks);

  const blocked = tasks.filter((task) => isBlocked(task, context));
  if (blocked.length > 0) {
    return refused("blocked-tasks", blocked.map((task) => task.id).join(", "));
  }

  const open = tasks.filter((task) => !isDone(task, context));
  if (open.length > 0 && ack !== "open-work") {
    return refused("open-work", `${open.length}`);
  }

  return allowed;
}

export type DeadlineStatus =
  | { readonly kind: "none" }
  | { readonly kind: "on-track"; readonly days: number }
  | { readonly kind: "due-today" }
  | { readonly kind: "late"; readonly days: number };

/**
 * What the card says under the name — two calendar days apart, never two
 * instants. "1 dia" means tomorrow, and it means that in every time zone.
 */
export function deadlineStatus(
  dueDate: CalendarDate | null,
  now: Date = new Date(),
): DeadlineStatus {
  if (!dueDate) return { kind: "none" };

  const days = calendarDaysBetween(calendarDateOf(now), dueDate);

  if (days === 0) return { kind: "due-today" };
  if (days > 0) return { kind: "on-track", days };
  return { kind: "late", days: Math.abs(days) };
}

/** Open work is what the grid counts under each project. */
export function openTaskCount(context: BoardContext): number {
  return liveTasks(context.tasks).filter((task) => !isDone(task, context)).length;
}

export function blockedTasks(context: BoardContext): Task[] {
  return liveTasks(context.tasks).filter((task) => isBlocked(task, context));
}
