/**
 * Movement and ordering (DEVELOPMENT_PLAN.md §3.6).
 *
 * `canMoveTask` is shared by both sides of the wire: the board calls it during
 * a drag to bounce the card before any request, and the service calls it to
 * decide whether to write. Column immutability is a different question and
 * lives in `canEditColumn`.
 */

import { type Decision, allowed, refused } from "@/lib/result";
import { unresolvedDependencies } from "./dependencies";
import type { BoardColumn, BoardContext, Task } from "./types";

export type MoveRefusal = "blocked" | "dependencies" | "checklist";

export type MoveRequest = {
  readonly task: Task;
  readonly from: BoardColumn;
  readonly to: BoardColumn;
  readonly context: BoardContext;
  /**
   * A refusal the person has explicitly acknowledged. Only `checklist` can be
   * acknowledged; it travels through the Server Action so the service checks
   * the same rule with the same acknowledgement instead of trusting a flag.
   */
  readonly ack?: MoveRefusal;
};

export function canMoveTask({
  task,
  from,
  to,
  context,
  ack,
}: MoveRequest): Decision<MoveRefusal> {
  if (to.id === from.id || to.phase !== "done") return allowed;

  // Tested apart from dependencies so the toast can say which one it was.
  if (task.blocked) return refused("blocked", task.id);

  const unresolved = unresolvedDependencies(task, context);
  if (unresolved.length > 0) {
    return refused("dependencies", unresolved.map((each) => each.id).join(", "));
  }

  const { total, done } = task.checklist;
  if (done < total && ack !== "checklist") {
    return refused("checklist", `${done}/${total}`);
  }

  return allowed;
}

export type ColumnOperation = "rename" | "delete" | "reorder" | "rephase";

/**
 * Planning and done are immutable: they cannot be renamed away from their
 * phase, deleted, or moved out of the first and last positions (§3.2).
 */
export function canEditColumn(
  column: BoardColumn,
  operation: ColumnOperation,
): Decision<"immutable-column"> {
  const immutablePhase = column.phase === "planning" || column.phase === "done";
  if (!immutablePhase) return allowed;
  if (operation === "rename") return allowed;
  return refused("immutable-column", `${column.phase}:${operation}`);
}

/* ------------------------------------------------------------------ *
 * Fractional index
 *
 * A card dropped between two neighbours takes the midpoint of their keys, so
 * a move writes one row instead of reindexing the column. Text keys always
 * have a midpoint, so rebalancing is about length, not exhaustion.
 * ------------------------------------------------------------------ */

const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const MAX_KEY_LENGTH = 32;

export function keyBetween(lower: string | null, upper: string | null): string {
  if (lower !== null && upper !== null && lower >= upper) {
    throw new Error(`keyBetween expects lower < upper, got ${lower} >= ${upper}`);
  }
  return midpoint(lower ?? "", upper);
}

/** True when a column's keys have grown long enough to be rewritten (§3.6). */
export function needsRebalance(
  keys: readonly string[],
  maxLength = MAX_KEY_LENGTH,
): boolean {
  return keys.some((key) => key.length > maxLength);
}

/** Evenly spaced keys for a fresh column, or for one being rebalanced. */
export function rebalance(count: number): string[] {
  const keys: string[] = [];
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    previous = keyBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}

function digitValue(key: string, index: number): number {
  const character = key[index];
  if (character === undefined) return 0;
  const value = DIGITS.indexOf(character);
  if (value < 0) throw new Error(`invalid ordering key: ${key}`);
  return value;
}

function digitAt(value: number): string {
  const character = DIGITS[value];
  if (character === undefined) throw new Error(`digit out of range: ${value}`);
  return character;
}

/**
 * Midpoint of two base-62 fractions. `upper === null` means "after everything".
 * Keys never end in the zero digit, which is what keeps them comparable.
 */
function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) {
    throw new Error(`midpoint expects lower < upper, got ${lower} >= ${upper}`);
  }

  if (upper !== null) {
    let shared = 0;
    while (digitAt(digitValue(lower, shared)) === upper[shared]) shared += 1;
    if (shared > 0) {
      return (
        upper.slice(0, shared) +
        midpoint(lower.slice(shared), upper.slice(shared))
      );
    }
  }

  const low = lower.length > 0 ? digitValue(lower, 0) : 0;
  const high = upper !== null ? digitValue(upper, 0) : DIGITS.length;

  if (high - low > 1) {
    return digitAt(Math.round(0.5 * (low + high)));
  }

  if (upper !== null && upper.length > 1) {
    return upper.slice(0, 1);
  }

  // The digits are consecutive: keep the lower one and descend a place.
  return digitAt(low) + midpoint(lower.slice(1), null);
}
