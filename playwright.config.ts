import { defineConfig, devices } from "@playwright/test";

const port = 3000;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
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
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/planora_dev",
      MAILPIT_URL: process.env.MAILPIT_URL ?? "http://127.0.0.1:8025",
      BETTER_AUTH_URL: `http://localhost:${port}`,
      // The gallery is the subject of the shell tests, and they run against a
      // production build.
      ENABLE_DEV_ROUTES: "1",
      // No third-party lookup from a test run.
      DISABLE_BREACH_CHECK: "1",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "planora-e2e-secret-planora-e2e-secret-32",
    },
  },
});
