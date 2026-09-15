import { test as base } from "@playwright/test";

/**
 * The suite's `test`, with one difference from Playwright's: every test
 * arrives from its own address.
 *
 * The rate limiter counts per IP, and every worker reaches localhost as `::1`,
 * which normalizes to a single shared bucket — so a parallel run spends one
 * client's allowance many times over. One address per *worker* is not enough
 * either: a worker signs up a dozen times a minute, and sign-up allows five.
 * One address per test is the honest model — each test is one person with one
 * account — and it leaves the production limit exactly as it is.
 */
export const test = base.extend({
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        "x-forwarded-for": addressFor(testInfo.testId),
      },
    });
  },
});

/** A stable address in 10.0.0.0/8 for a test id, never .0 or .255. */
function addressFor(testId: string): string {
  let hash = 2166136261;
  for (const character of testId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  const octet = (shift: number) => 1 + ((hash >>> shift) & 0xff) % 254;
  return `10.${octet(0)}.${octet(8)}.${octet(16)}`;
}

export { expect } from "@playwright/test";
