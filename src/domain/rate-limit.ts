/**
 * Rate limiting, as a decision (DEVELOPMENT_PLAN.md §7 Phase 10).
 *
 * A fixed window: a counter and the moment the window opened. Ask it whether
 * one more request fits, and it answers with the decision and the counter to
 * store — nothing else. No clock, no database, no knowledge that either exists,
 * which is what lets the awkward cases be tested without a server: the first
 * request of a window, the one that exactly reaches the limit, the one that
 * arrives a millisecond before the window turns over.
 *
 * A fixed window is the cheap approximation and it is the honest one to name:
 * sixty writes at the end of one minute and sixty at the start of the next are
 * a hundred and twenty inside two seconds. The limit exists so one account
 * cannot run the board into the ground by accident or by script, not to shape
 * traffic, and a sliding window costs a second row and a second write per
 * request to halve a burst nobody has yet made.
 */

import { allowed, refused, type Decision } from "@/lib/result";

export type Limit = {
  /** How many requests fit in one window. */
  readonly max: number;
  /** How long the window lasts, in milliseconds. */
  readonly windowMs: number;
};

/** What the store holds for one key, and what it should hold next. */
export type Counter = {
  readonly count: number;
  /** When the current window opened, in milliseconds since the epoch. */
  readonly openedAt: number;
};

export type LimitDecision = {
  readonly decision: Decision<"rate-limited">;
  /** What to store for this key, whether or not the request was allowed. */
  readonly next: Counter;
  /** How long until the window turns over, in milliseconds. Zero when allowed. */
  readonly retryInMs: number;
};

/**
 * The limits the plan names: sixty writes a minute per person, and ten a
 * minute for the ones that reach somebody else's inbox.
 *
 * `signUp` is five accounts a minute per connection, counted only once the
 * password policy has accepted the password (ADR 0008): a refused password
 * creates nothing and sends nothing, so it costs nothing. Before, Better Auth
 * counted every attempt before the policy ran, and a person trying passwords
 * hit the wall after five refusals.
 *
 * Every window here is at most a minute: Better Auth prunes the table it shares
 * with these counters by age, whatever the key, once rows are older than its
 * own longest window.
 */
export const LIMITS = {
  write: { max: 60, windowMs: 60_000 },
  invite: { max: 10, windowMs: 60_000 },
  signUp: { max: 5, windowMs: 60_000 },
} as const satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

/**
 * Whether one more request fits.
 *
 * A counter from a window that has since closed is not carried forward: the
 * window reopens at `now` with this request as its first. A counter from the
 * future — two application instances whose clocks disagree — is treated the
 * same way rather than trusted, because the alternative is a key that locks
 * itself until the clocks converge.
 */
export function consume(
  limit: Limit,
  stored: Counter | null,
  now: number,
): LimitDecision {
  const current =
    stored && stored.openedAt <= now && now - stored.openedAt < limit.windowMs
      ? stored
      : null;

  if (!current) {
    return {
      decision: allowed,
      next: { count: 1, openedAt: now },
      retryInMs: 0,
    };
  }

  if (current.count >= limit.max) {
    return {
      decision: refused("rate-limited"),
      // The refused request does not extend the window, and it does not count:
      // a client retrying in a loop would otherwise hold its own door shut.
      next: current,
      retryInMs: current.openedAt + limit.windowMs - now,
    };
  }

  return {
    decision: allowed,
    next: { count: current.count + 1, openedAt: current.openedAt },
    retryInMs: 0,
  };
}

/**
 * The key one allowance is counted under: a person for the write buckets, a
 * connection's address for sign-up, where there is nobody yet.
 *
 * Per person and per bucket, not per workspace: the limit is there to stop one
 * account from running away, and somebody who belongs to three workspaces has
 * one pair of hands. The prefix keeps our keys from ever colliding with the
 * ones Better Auth writes into the same table for its own endpoints.
 */
export function limitKey(bucket: Bucket, subject: string): string {
  return `planora:${bucket}:${subject}`;
}
