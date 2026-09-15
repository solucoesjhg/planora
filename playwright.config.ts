import { defineConfig, devices } from "@playwright/test";
import { databaseUrl } from "./tests/e2e/support/database";

const port = 3000;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  /**
   * A production build and one browser per worker, all on the developer's own
   * machine: five of them starve the server and tests fail on timing rather
   * than on behaviour. CI, with a runner to itself, keeps the default.
   */
  workers: process.env.CI ? undefined : 3,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      DATABASE_URL: databaseUrl(),
      MAILPIT_URL: process.env.MAILPIT_URL ?? "http://127.0.0.1:8025",
      BETTER_AUTH_URL: `http://localhost:${port}`,
      // The gallery is the subject of the shell tests, and they run against a
      // production build.
      ENABLE_DEV_ROUTES: "1",
      // No third-party lookup from a test run.
      DISABLE_BREACH_CHECK: "1",
      // A production build, but the bytes belong on this disk, not in a bucket,
      // and the mail belongs in Mailpit, not in Resend.
      STORAGE_DRIVER: "local",
      STORAGE_DIR: ".storage/e2e",
      EMAIL_DRIVER: "mailpit",
      // The clock's door exists only with a secret; the suite knocks with this one.
      CRON_SECRET: "e2e-cron-secret",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "planora-e2e-secret-planora-e2e-secret-32",
    },
  },
});
