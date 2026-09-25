/**
 * The live password check (ADR 0008).
 *
 * The sign-up and reset forms ask this endpoint about a password while the
 * person types, so a refusal arrives before "Criar conta" is pressed rather
 * than after — and costs nothing but a lookup. It is a Better Auth endpoint,
 * not a Server Action: Next runs a client's Server Actions one at a time and
 * cannot cancel them, and a check that follows typing has to be cancellable.
 * Being one also gives it Better Auth's rate limiter, keyed by the same
 * address as every other auth endpoint.
 *
 * It answers with a verdict and nothing else. It takes a password and no name,
 * address or token, and reads no table, so it tells a caller nothing about any
 * account; what it does tell — whether a string is common, or common in breach
 * dumps — anybody can already ask the public corpus. The shape rules run
 * first, so garbage never costs a lookup. The name and address rule runs in
 * the form, which holds both, and again at submit.
 */

import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import {
  type PasswordVerdict,
  checkPasswordShape,
  judgeBreachCount,
} from "@/domain/passwords";
import { PASSWORD_CHECK_PATH } from "@/lib/password-check";
import { isRefused } from "@/lib/result";
import { type BreachLookup, breachCount } from "./password-policy";

export type PasswordCheckOptions = {
  /** Off in the E2E suite, which must not reach a third party. */
  readonly checkBreaches: boolean;
  readonly lookup?: BreachLookup;
};

export async function passwordVerdict(
  password: string,
  { checkBreaches, lookup = {} }: PasswordCheckOptions,
): Promise<PasswordVerdict> {
  const shape = checkPasswordShape(password);
  if (isRefused(shape)) return shape.reason;
  if (!checkBreaches) return "accepted";

  const count = await breachCount(password, lookup);
  if (count === null) return "unavailable";

  const judged = judgeBreachCount(count);
  return isRefused(judged) ? judged.reason : "accepted";
}

export function passwordCheck(options: PasswordCheckOptions) {
  return {
    id: "planora-password-check",
    endpoints: {
      checkPassword: createAuthEndpoint(
        PASSWORD_CHECK_PATH,
        {
          method: "POST",
          // Longer than any password the policy accepts, so "too-long" is an
          // answer; short enough that nobody hashes a novel on our account.
          body: z.object({ password: z.string().max(1024) }),
          // A verdict about a password must not sit in any cache.
          metadata: { noStore: true },
        },
        async (ctx) => ctx.json({ verdict: await passwordVerdict(ctx.body.password, options) }),
      ),
    },
  } satisfies BetterAuthPlugin;
}
