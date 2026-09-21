import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a build-time guard: it throws the moment a client
      // bundle pulls a server module in. There is no client here, and the
      // modules under test are exactly the ones that carry it.
      "server-only": fileURLToPath(
        new URL("./src/server/test-support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Picks the suite's own database and creates it — never the app's.
    globalSetup: ["src/server/test-support/global-setup.ts"],
    // One database, one writer: these tests share a schema.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
