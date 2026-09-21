import { test, expect } from "./support/test";
import { registerAndVerify } from "./support/account";
import { securityHeaders } from "../../src/lib/security-headers";

/**
 * The headers, proved where they are actually served (DEVELOPMENT_PLAN.md §7
 * Phase 10).
 *
 * This suite runs `pnpm build && pnpm start`, which is the reason the table
 * moved out of `vercel.json`: that file is applied by Vercel's edge and is
 * invisible here, so for as long as it held the headers nothing in the
 * repository could tell whether they were still being sent. The expectation
 * below is built from the same module `next.config.ts` calls — which proves
 * the wiring, not the policy; the policy itself is asserted directive by
 * directive in `src/lib/security-headers.test.ts`.
 *
 * The suite boots with `STORAGE_DRIVER=local` and no `SUPABASE_URL`
 * (playwright.config.ts), so the deployed shape of the policy differs in one
 * place only: the bucket's origin is absent here.
 */
const expected = securityHeaders({ development: false, storageOrigin: null });

test("a page carries every security header", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.status()).toBe(200);

  const served = response.headers();
  for (const { key, value } of expected) {
    expect(served[key.toLowerCase()], key).toBe(value);
  }
});

test("a static file carries them too", async ({ request }) => {
  // `source: "/(.*)"` is checked before the filesystem, so /public and
  // /_next are covered as well — the icon is the cheapest proof of it.
  const response = await request.get("/favicon.ico");
  expect(response.status()).toBe(200);

  const served = response.headers();
  expect(served["content-security-policy"]).toBe(
    expected.find((header) => header.key === "Content-Security-Policy")?.value,
  );
  expect(served["x-content-type-options"]).toBe("nosniff");
});

/**
 * The policy is only worth having if the application still runs under it. A
 * refusal is a console error and nothing else — the page renders, half the
 * styles arrive, and nobody notices until a person does — so the browser's own
 * complaints are the assertion.
 */
test("the application raises no violation of its own policy", async ({
  page,
  request,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|refused to/i.test(text)) violations.push(text);
  });

  // Signing up, verifying and landing: the anti-flash theme script, the fonts,
  // the stylesheet, React's inline flight data, and a form posting to a Server
  // Action — every part of the page the policy has an opinion about.
  await registerAndVerify(page, request);
  await page.goto("/dashboard");
  await expect(page.getByTestId("rail")).toBeVisible();

  expect(violations).toEqual([]);
});
