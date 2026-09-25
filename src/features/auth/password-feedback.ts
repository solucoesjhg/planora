/**
 * What the password field says, decided without React (ADR 0008).
 *
 * The shape rules run here, on every keystroke, from the same domain function
 * the server runs before it stores a password. The breach verdict comes from
 * the server's live check; until it arrives the field says it is checking.
 */

import type { FieldStatus } from "@/components/ui/field";
import {
  type Identity,
  type PasswordRefusal,
  type PasswordVerdict,
  checkPasswordShape,
} from "@/domain/passwords";
import { isRefused } from "@/lib/result";
import { PASSWORD_FEEDBACK, PASSWORD_REFUSALS } from "@/lib/strings";

export type PasswordFeedback =
  | { readonly kind: "idle" }
  | { readonly kind: "refused"; readonly reason: PasswordRefusal }
  | { readonly kind: "checking" }
  | { readonly kind: "accepted" }
  | { readonly kind: "unavailable" };

/**
 * `settled` is whether the person has stopped — paused, left the field, or
 * pressed the button. A password still too short is only called that once
 * they have: saying so after the first letter would be nagging.
 */
export function passwordFeedback(
  password: string,
  identity: Identity,
  verdict: PasswordVerdict | undefined,
  settled: boolean,
): PasswordFeedback {
  if (password.length === 0) return { kind: "idle" };

  const shape = checkPasswordShape(password, identity);
  if (isRefused(shape)) {
    return shape.reason === "too-short" && !settled
      ? { kind: "idle" }
      : { kind: "refused", reason: shape.reason };
  }

  switch (verdict) {
    case undefined:
      return { kind: "checking" };
    case "accepted":
      return { kind: "accepted" };
    case "unavailable":
      return { kind: "unavailable" };
    default:
      return { kind: "refused", reason: verdict };
  }
}

/**
 * Whether the server is worth asking. The name and address rule is left out on
 * purpose: the server's check does not know them, and the person may still fix
 * the name — the breach verdict should be waiting when they do.
 */
export function worthAsking(password: string): boolean {
  return password.length > 0 && !isRefused(checkPasswordShape(password));
}

export function feedbackStatus(feedback: PasswordFeedback): FieldStatus {
  switch (feedback.kind) {
    case "idle":
      return { tone: "neutral", text: PASSWORD_FEEDBACK.hint };
    case "refused":
      return { tone: "danger", text: PASSWORD_REFUSALS[feedback.reason] };
    case "checking":
      return { tone: "neutral", text: PASSWORD_FEEDBACK.checking };
    case "accepted":
      return { tone: "success", text: PASSWORD_FEEDBACK.accepted };
    case "unavailable":
      return { tone: "neutral", text: PASSWORD_FEEDBACK.unavailable };
  }
}

/** How many verdicts the field remembers — the last few passwords tried. */
export const REMEMBERED_VERDICTS = 20;

/** The verdicts known so far, with this one added and the oldest let go. */
export function remember(
  known: ReadonlyMap<string, PasswordVerdict>,
  password: string,
  verdict: PasswordVerdict,
): ReadonlyMap<string, PasswordVerdict> {
  const next = new Map(known);
  next.delete(password);
  next.set(password, verdict);
  while (next.size > REMEMBERED_VERDICTS) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}
