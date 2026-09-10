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

/**
 * The token boundary (DEVELOPMENT_PLAN.md §7 Phase 4).
 *
 * Colour is declared once, in `src/styles/tokens.css`, and reaches components
 * as a utility built from a token. A hex literal in a component is how a
 * design system turns into a pile of nearly-matching greens — and it is also
 * how a dark-only value ends up unreadable in the light theme.
 */
const tokenBoundary = {
  files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-fA-F])/]",
        message:
          "Colour belongs in src/styles/tokens.css and arrives as a utility. See DEVELOPMENT_PLAN.md §7 Phase 4.",
      },
      {
        selector:
          "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-fA-F])/]",
        message:
          "Colour belongs in src/styles/tokens.css and arrives as a utility. See DEVELOPMENT_PLAN.md §7 Phase 4.",
      },
      {
        selector:
          "Literal[value=/\\b(?:rgba?|hsla?)\\s*\\(/]",
        message:
          "Colour belongs in src/styles/tokens.css and arrives as a utility. See DEVELOPMENT_PLAN.md §7 Phase 4.",
      },
    ],
  },
};

/**
 * Playwright's fixtures take a callback named `use`, which the React Hooks rule
 * reads as the `use` hook being called outside a component. There is no React
 * in the E2E suite.
 */
const playwrightFixtures = {
  files: ["tests/e2e/**/*.ts"],
  rules: {
    "react-hooks/rules-of-hooks": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  domainBoundary,
  tokenBoundary,
  playwrightFixtures,
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
