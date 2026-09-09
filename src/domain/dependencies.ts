/**
 * Dependencies and blocking (DEVELOPMENT_PLAN.md §3.7).
 *
 * A task is blocked when its manual flag is set, or when any task it depends
 * on is not done. Blocking is transitive — a chain surfaces the real root, not
 * the nearest link — and a new edge is rejected before it can close a cycle.
 */

import { type Decision, allowed, refused } from "@/lib/result";
import { type BoardContext, type Task, isDone, taskById } from "./types";

export type DependencyRefusal = "self" | "duplicate" | "cycle";

/** Dependencies that are missing, deleted or not yet done. */
export function unresolvedDependencies(
  task: Task,
  context: BoardContext,
): Task[] {
  const unresolved: Task[] = [];
  for (const dependencyId of task.dependsOn) {
    const dependency = taskById(context, dependencyId);
    if (!dependency || dependency.deletedAt !== null) continue;
    if (!isDone(dependency, context)) unresolved.push(dependency);
  }
  return unresolved;
}

/**
 * The union the health engine reads: manual flag or an unresolved dependency.
 * A done task is never blocked — finishing clears the flag (§3.4).
 */
export function isBlocked(task: Task, context: BoardContext): boolean {
  if (isDone(task, context)) return false;
  if (task.blocked) return true;
  return unresolvedDependencies(task, context).length > 0;
}

/**
 * The tasks actually holding the chain up: the ends of the blocking walk,
 * which are what a person needs to act on. A manually blocked task is its own
 * root.
 */
export function blockingRoots(task: Task, context: BoardContext): Task[] {
  const roots = new Map<string, Task>();
  const seen = new Set<string>([task.id]);
  const queue = [...unresolvedDependencies(task, context)];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);

    const next = unresolvedDependencies(current, context);
    if (next.length === 0 || current.blocked) {
      roots.set(current.id, current);
    }
    queue.push(...next);
  }

  if (roots.size === 0 && task.blocked) roots.set(task.id, task);
  return [...roots.values()];
}

/**
 * Depth-first walk from the proposed dependency back towards the task. If it
 * arrives, the edge would close a cycle, and the offending path travels in the
 * refusal so the interface can name it.
 */
export function canAddDependency(
  taskId: string,
  dependsOnId: string,
  context: BoardContext,
): Decision<DependencyRefusal> {
  if (taskId === dependsOnId) {
    return refused("self", taskId);
  }

  const task = taskById(context, taskId);
  if (task?.dependsOn.includes(dependsOnId)) {
    return refused("duplicate", `${taskId} -> ${dependsOnId}`);
  }

  const path = pathBetween(dependsOnId, taskId, context);
  if (path) {
    return refused("cycle", [taskId, ...path].join(" -> "));
  }

  return allowed;
}

/** The dependency path from `fromId` to `toId`, or null when none exists. */
function pathBetween(
  fromId: string,
  toId: string,
  context: BoardContext,
): string[] | null {
  const seen = new Set<string>();

  const walk = (currentId: string, trail: string[]): string[] | null => {
    if (currentId === toId) return [...trail, currentId];
    if (seen.has(currentId)) return null;
    seen.add(currentId);

    const current = taskById(context, currentId);
    if (!current) return null;

    for (const nextId of current.dependsOn) {
      const found = walk(nextId, [...trail, currentId]);
      if (found) return found;
    }
    return null;
  };

  return walk(fromId, []);
}
