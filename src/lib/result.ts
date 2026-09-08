/**
 * The Result type (DEVELOPMENT_PLAN.md §2.3).
 *
 * Domain refusals are values, not exceptions. The domain answers
 * `Allowed | Refused` — it decides, it does not perform. A service wraps the
 * work it did in `Ok | Refused`. A thrown error means something unexpected,
 * and only those reach an error boundary.
 */

export type Refused<Reason extends string = string> = {
  readonly kind: "refused";
  readonly reason: Reason;
  readonly detail?: string;
};

export type Allowed = { readonly kind: "allowed" };

export type Ok<Value> = { readonly kind: "ok"; readonly value: Value };

export type Decision<Reason extends string = string> = Allowed | Refused<Reason>;

export type Result<Value, Reason extends string = string> =
  | Ok<Value>
  | Refused<Reason>;

export const allowed: Allowed = { kind: "allowed" };

export function ok<Value>(value: Value): Ok<Value> {
  return { kind: "ok", value };
}

export function refused<Reason extends string>(
  reason: Reason,
  detail?: string,
): Refused<Reason> {
  return detail === undefined
    ? { kind: "refused", reason }
    : { kind: "refused", reason, detail };
}

export function isRefused<Reason extends string>(
  result: Decision<Reason> | Result<unknown, Reason>,
): result is Refused<Reason> {
  return result.kind === "refused";
}

export function isOk<Value, Reason extends string>(
  result: Result<Value, Reason>,
): result is Ok<Value> {
  return result.kind === "ok";
}
