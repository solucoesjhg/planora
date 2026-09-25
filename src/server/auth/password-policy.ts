/**
 * The password policy, as the server applies it (ADR 0008).
 *
 * The rules live in `src/domain/passwords.ts`, where the sign-up form runs the
 * same shape check as the person types. What stays here is what only the
 * server can do: ask the breach corpus how many times a password has leaked.
 */

import {
  type Identity,
  type PasswordRefusal,
  checkPasswordShape,
  judgeBreachCount,
} from "@/domain/passwords";
import { type Decision, allowed } from "@/lib/result";

export type BreachLookup = {
  /** Tests inject the corpus; production asks api.pwnedpasswords.com. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

/**
 * How many times the breach corpus has seen this password, or `null` when it
 * could not be asked.
 *
 * Through k-anonymity: only the first five characters of the SHA-1 hash ever
 * leave this process, and the answer comes back as a list of `SUFFIX:COUNT`
 * lines to search locally. The password itself is never sent. The request asks
 * for padding, so the list is always a few hundred lines long whatever the
 * prefix; padding lines carry a count of zero, and a zero never refuses.
 *
 * Anything unexpected — the service down or slow, a redirect, a count that is
 * not a plain number — is `null`, never a refusal: a best-effort check that
 * blocks the door when it cannot answer is worse than no check.
 */
export async function breachCount(
  password: string,
  options: BreachLookup = {},
): Promise<number | null> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);

  try {
    const hash = (await sha1Hex(password)).toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await doFetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    for (const line of (await response.text()).split(/\r?\n/)) {
      const [candidate, count] = line.split(":");
      if (candidate?.trim().toUpperCase() !== suffix) continue;

      const value = count?.trim() ?? "";
      if (!/^\d+$/.test(value)) return null;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : null;
    }

    return 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The whole policy: the shape rules first, so a password they refuse never
 * costs a lookup, then the breach count against the threshold. When the
 * corpus cannot be asked, the password is accepted — the shape rules have
 * already run.
 */
export async function checkPassword(
  password: string,
  identity: Identity = {},
  options: { checkBreaches?: boolean } & BreachLookup = {},
): Promise<Decision<PasswordRefusal>> {
  const shape = checkPasswordShape(password, identity);
  if (shape.kind === "refused") return shape;

  if (options.checkBreaches === false) return allowed;

  const count = await breachCount(password, options);
  return count === null ? allowed : judgeBreachCount(count);
}

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));

  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
