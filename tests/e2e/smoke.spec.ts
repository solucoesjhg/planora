import { test, expect } from "./support/test";

// Phase 0 has no product yet. This proves the harness itself works, and is
// replaced by the real flows from Phase 3 on.
test("the app serves a page", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
});
