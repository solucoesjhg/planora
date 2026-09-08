import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The domain boundary (DEVELOPMENT_PLAN.md §2.2).
 *
 * `src/domain/` holds pure functions: progress, health, kanban, dependencies,
 * phase history. The board imports them to bounce a card before any request,
 * and the service imports the same functions to decide whether to write. That
 * only holds while the layer stays free of the framework, the database and the
 * server — so the rule is enforced here rather than agreed in prose.
 */
const domainBoundary = {
  files: ["src/domain/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "react", message: "domain/ is pure: no React." },
          { name: "react-dom", message: "domain/ is pure: no React." },
          { name: "next", message: "domain/ is pure: no Next." },
          { name: "server-only", message: "domain/ runs on both sides." },
          {
            name: "drizzle-orm",
            message: "domain/ knows nothing about the database.",
          },
        ],
        patterns: [
          {
            group: [
              "next/*",
              "drizzle-orm/*",
              "@/app/*",
              "@/server/*",
              "@/features/*",
              "@/components/*",
              "../app/*",
              "../server/*",
              "../features/*",
              "../components/*",
              "../../app/*",
              "../../server/*",
              "../../features/*",
              "../../components/*",
            ],
            message:
              "domain/ may only import from domain/ and lib/. See DEVELOPMENT_PLAN.md §2.2.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  domainBoundary,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Reference material copied from the v1, not source.
    "docs/**",
  ]),
]);

export default eslintConfig;
