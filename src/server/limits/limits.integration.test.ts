import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@/domain/rate-limit";
import { isRefused } from "@/lib/result";
import { connectAndMigrate, databaseUrl, hasDatabase } from "@/server/test-support/database";
import type { Connection } from "@/server/db/client";

/**
 * The allowance, against a real table (DEVELOPMENT_PLAN.md §7 Phase 10).
 *
 * The decision itself is pure and tested in `src/domain/rate-limit.test.ts`.
 * What needs a database is the part that cannot be reasoned about: that the
 * count survives the refusal, that two requests arriving together are counted
 * twice rather than once, and that the window is per person.
 *
 * The limiter deliberately runs on the system lane — the count has to outlive a
 * transaction that rolls back — so the suite points that lane at its own
 * database before the pool is built. The module is lazy, and every test file
 * runs in its own worker, so this is the first call either way.
 */

const suite = describe.skipIf(!hasDatabase);

suite("the allowance on write actions", () => {
  let connection: Connection;
  let consumeAllowance: typeof import("./index").consumeAllowance;
  let allowanceUsed: typeof import("./index").allowanceUsed;
  let forgetAllowance: typeof import("./index").forgetAllowance;

  const person = "3f6f4a52-1f2b-4a1e-9c3d-000000000001";
  const other = "3f6f4a52-1f2b-4a1e-9c3d-000000000002";

  beforeAll(async () => {
    connection = await connectAndMigrate();
    process.env["SYSTEM_DATABASE_URL"] = databaseUrl;
    ({ consumeAllowance, allowanceUsed, forgetAllowance } = await import("./index"));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await forgetAllowance("write", person);
    await forgetAllowance("write", other);
    await forgetAllowance("invite", person);
  });

  it("allows sixty writes in a minute and refuses the sixty-first", async () => {
    const now = 1_700_000_000_000;

    for (let attempt = 0; attempt < LIMITS.write.max; attempt += 1) {
      const result = await consumeAllowance("write", person, now + attempt);
      expect(isRefused(result)).toBe(false);
    }

    const refused = await consumeAllowance("write", person, now + LIMITS.write.max);

    expect(isRefused(refused) && refused.reason).toBe("rate-limited");
    expect(await allowanceUsed("write", person)).toBe(LIMITS.write.max);
  });

  it("opens the door again when the window turns over", async () => {
    const now = 1_700_000_000_000;
    for (let attempt = 0; attempt < LIMITS.write.max; attempt += 1) {
      await consumeAllowance("write", person, now);
    }
    expect(isRefused(await consumeAllowance("write", person, now))).toBe(true);

    const later = await consumeAllowance("write", person, now + LIMITS.write.windowMs);

    expect(isRefused(later)).toBe(false);
    expect(await allowanceUsed("write", person)).toBe(1);
  });

  it("counts invitations in a bucket of their own, ten a minute", async () => {
    const now = 1_700_000_000_000;

    for (let attempt = 0; attempt < LIMITS.invite.max; attempt += 1) {
      expect(isRefused(await consumeAllowance("invite", person, now))).toBe(false);
    }

    expect(isRefused(await consumeAllowance("invite", person, now))).toBe(true);
    // Inviting ten people does not stop you moving a card.
    expect(isRefused(await consumeAllowance("write", person, now))).toBe(false);
  });

  it("counts one person's allowance and nobody else's", async () => {
    const now = 1_700_000_000_000;
    for (let attempt = 0; attempt < LIMITS.write.max; attempt += 1) {
      await consumeAllowance("write", person, now);
    }

    expect(isRefused(await consumeAllowance("write", person, now))).toBe(true);
    expect(isRefused(await consumeAllowance("write", other, now))).toBe(false);
  });

  /**
   * The row lock is the difference between a count and an estimate: without it
   * two requests arriving together both read fifty-nine and both write sixty.
   */
  it("counts requests that arrive together, one each", async () => {
    const now = 1_700_000_000_000;

    await Promise.all(
      Array.from({ length: 10 }, () => consumeAllowance("write", person, now)),
    );

    expect(await allowanceUsed("write", person)).toBe(10);
  });

  /**
   * The design review of ADR 0008: `select … for update` locks nothing while
   * the row does not exist, and on a pool wide enough to run them at once,
   * twenty sign-ups from a new connection all read "none" and all got in
   * through a limit of five.
   */
  it("admits exactly the limit when a burst arrives before any row exists", async () => {
    const wide = await connectAndMigrate(20);
    const address = "203.0.113.200";
    const now = 1_700_000_000_000;

    try {
      await forgetAllowance("signUp", address);

      const results = await Promise.all(
        Array.from({ length: 20 }, () => consumeAllowance("signUp", address, now, wide.db)),
      );

      expect(results.filter((result) => !isRefused(result))).toHaveLength(LIMITS.signUp.max);
      expect(await allowanceUsed("signUp", address, wide.db)).toBe(LIMITS.signUp.max);

      // And a burst counted from nothing is counted once each.
      await forgetAllowance("write", person);
      await Promise.all(
        Array.from({ length: 10 }, () => consumeAllowance("write", person, now, wide.db)),
      );
      expect(await allowanceUsed("write", person, wide.db)).toBe(10);
    } finally {
      await forgetAllowance("signUp", address);
      await wide.close();
    }
  });
});
