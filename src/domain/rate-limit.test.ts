import { describe, expect, it } from "vitest";
import { isRefused } from "@/lib/result";
import { consume, limitKey, LIMITS, type Counter } from "./rate-limit";

const limit = { max: 3, windowMs: 1_000 };
const start = 1_000_000;

describe("consume", () => {
  it("opens a window on the first request", () => {
    const { decision, next } = consume(limit, null, start);

    expect(isRefused(decision)).toBe(false);
    expect(next).toEqual({ count: 1, openedAt: start });
  });

  it("counts inside the window without moving it", () => {
    const stored: Counter = { count: 1, openedAt: start };

    const { decision, next } = consume(limit, stored, start + 400);

    expect(isRefused(decision)).toBe(false);
    expect(next).toEqual({ count: 2, openedAt: start });
  });

  it("allows the request that exactly reaches the limit", () => {
    const stored: Counter = { count: 2, openedAt: start };

    const { decision, next } = consume(limit, stored, start + 500);

    expect(isRefused(decision)).toBe(false);
    expect(next.count).toBe(3);
  });

  it("refuses the one after it, and says how long the door stays shut", () => {
    const stored: Counter = { count: 3, openedAt: start };

    const { decision, retryInMs } = consume(limit, stored, start + 700);

    expect(isRefused(decision) && decision.reason).toBe("rate-limited");
    expect(retryInMs).toBe(300);
  });

  it("does not let a refused request hold its own door shut", () => {
    const stored: Counter = { count: 3, openedAt: start };

    const first = consume(limit, stored, start + 700);
    const second = consume(limit, first.next, start + 900);

    expect(first.next).toEqual(stored);
    expect(second.retryInMs).toBe(100);
  });

  it("reopens the window on the request that arrives after it closed", () => {
    const stored: Counter = { count: 3, openedAt: start };

    const { decision, next } = consume(limit, stored, start + 1_000);

    expect(isRefused(decision)).toBe(false);
    expect(next).toEqual({ count: 1, openedAt: start + 1_000 });
  });

  it("refuses the request a millisecond before the window turns over", () => {
    const stored: Counter = { count: 3, openedAt: start };

    const { decision } = consume(limit, stored, start + 999);

    expect(isRefused(decision)).toBe(true);
  });

  /**
   * Two instances whose clocks disagree used to be able to write a window that
   * had not started yet; every request until the clocks converged then read a
   * counter it could not clear.
   */
  it("does not trust a counter from the future", () => {
    const stored: Counter = { count: 3, openedAt: start + 5_000 };

    const { decision, next } = consume(limit, stored, start);

    expect(isRefused(decision)).toBe(false);
    expect(next).toEqual({ count: 1, openedAt: start });
  });
});

describe("the limits the plan names", () => {
  it("is sixty writes a minute and ten invitations", () => {
    expect(LIMITS.write).toEqual({ max: 60, windowMs: 60_000 });
    expect(LIMITS.invite).toEqual({ max: 10, windowMs: 60_000 });
    // Five accounts a minute per connection, counted after the password
    // policy (ADR 0008).
    expect(LIMITS.signUp).toEqual({ max: 5, windowMs: 60_000 });
  });

  /**
   * Better Auth prunes the table these counters share with its own by age,
   * whatever the key, once rows outlive its longest window — a minute. A
   * longer window here would be forgotten halfway through.
   */
  it("keeps every window to a minute or less", () => {
    for (const limit of Object.values(LIMITS)) {
      expect(limit.windowMs).toBeLessThanOrEqual(60_000);
    }
  });
});

describe("limitKey", () => {
  it("counts a person, not a workspace", () => {
    expect(limitKey("write", "user-1")).toBe("planora:write:user-1");
  });

  /** The table is shared with Better Auth, whose keys are paths and addresses. */
  it("cannot collide with the keys Better Auth writes", () => {
    expect(limitKey("invite", "user-1").startsWith("planora:")).toBe(true);
  });
});
