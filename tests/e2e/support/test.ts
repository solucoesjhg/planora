import { test as base } from "@playwright/test";

/**
 * The suite's `test`, with one difference from Playwright's: every worker
 * arrives from its own address.
 *
 * The rate limiter counts per IP, and every worker reaches localhost as `::1`,
 * which normalizes to a single shared bucket — so five workers signing up
 * spend one worker's allowance five times over. Giving each its own
 * `x-forwarded-for` counts them apart, the way real clients are counted apart,
 * and leaves the production limit exactly as it is.
 */
export const test = base.extend({
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        "x-forwarded-for": `10.${testInfo.workerIndex + 1}.0.1`,
      },
    });
  },
});

export { expect } from "@playwright/test";
