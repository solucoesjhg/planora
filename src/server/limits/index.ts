import "server-only";

import { eq } from "drizzle-orm";
import { consume, limitKey, LIMITS, type Bucket } from "@/domain/rate-limit";
import { newId } from "@/lib/id";
import { isRefused, refused, type Result } from "@/lib/result";
import type { TenantContext } from "@/server/auth/tenant";
import { getSystemDatabase, withTenant, type Transaction } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

/**
 * The rate limit on our own write actions (DEVELOPMENT_PLAN.md §7 Phase 10).
 *
 * Better Auth already limits its endpoints — sign-in, sign-up, the password
 * reset — through the `rate_limits` table it owns. Nothing limited Planora's
 * own thirty-four Server Actions, so one account could move a card sixty times
 * a second for as long as it liked.
 *
 * The counter lives in the same table, under keys prefixed `planora:` so the
 * two users of it cannot collide, and it is read and written on the system
 * lane: the count has to survive the refusal, and a refused request that rolled
 * its own transaction back would never increment anything.
 *
 * `select … for update` is what makes it a count rather than an estimate. Two
 * requests arriving together would otherwise both read fifty-nine and both
 * write sixty; the row lock serialises them per key, which is per person, so
 * nobody waits on anybody else's allowance.
 */

export type Limited<Failure extends string> = Failure | "rate-limited";

export async function consumeAllowance(
  bucket: Bucket,
  userId: string,
  now = Date.now(),
): Promise<Result<undefined, "rate-limited">> {
  const key = limitKey(bucket, userId);

  return getSystemDatabase().transaction(async (tx) => {
    const [stored] = await tx
      .select({ count: rateLimits.count, openedAt: rateLimits.lastRequest })
      .from(rateLimits)
      .where(eq(rateLimits.key, key))
      .for("update");

    const { decision, next } = consume(
      LIMITS[bucket],
      stored ? { count: stored.count, openedAt: stored.openedAt } : null,
      now,
    );

    // The refused request does not change the counter, so it does not need a
    // write: the row is already what the next request should read.
    if (isRefused(decision)) return refused("rate-limited" as const);

    await tx
      .insert(rateLimits)
      .values({ id: newId(), key, count: next.count, lastRequest: next.openedAt })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: next.count, lastRequest: next.openedAt },
      });

    return { kind: "ok" as const, value: undefined };
  });
}

/**
 * A write action, in the order that matters: the allowance first, the scope
 * second. A refused request never opens a transaction, never applies a
 * setting, and never reaches a repository — which is the point of refusing it.
 *
 * Everything below this line receives the transaction as the `Executor` it
 * already accepts, so no service and no repository changed shape for either
 * the limit or the barrier (ADR 0002).
 */
export async function writing<Value, Failure extends string>(
  context: TenantContext,
  bucket: Bucket,
  run: (tx: Transaction) => Promise<Result<Value, Failure>>,
): Promise<Result<Value, Limited<Failure>>> {
  const allowance = await consumeAllowance(bucket, context.userId);
  if (isRefused(allowance)) return allowance;

  return withTenant(context, run);
}

/**
 * How many requests are left in the current window, for a test to assert on
 * without reaching into the table itself.
 */
export async function allowanceUsed(bucket: Bucket, userId: string): Promise<number> {
  const [row] = await getSystemDatabase()
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(eq(rateLimits.key, limitKey(bucket, userId)));
  return row?.count ?? 0;
}

/** Clears one person's allowance. The test harness uses it; nothing else does. */
export async function forgetAllowance(bucket: Bucket, userId: string): Promise<void> {
  await getSystemDatabase()
    .delete(rateLimits)
    .where(eq(rateLimits.key, limitKey(bucket, userId)));
}
