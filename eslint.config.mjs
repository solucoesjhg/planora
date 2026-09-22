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
 * The lane boundary (DEVELOPMENT_PLAN.md §2.4 · ADR 0002).
 *
 * Every access to the database goes through one of four lanes, and two of them
 * are dangerous to reach for. `getSystemDatabase()` connects as the role that
 * holds `BYPASSRLS`, so a caller that picks it has stepped outside the barrier
 * the phase exists to build; `getDatabase()` is the raw pool the lanes open
 * their own transactions on, and a statement sent on it outside a lane carries
 * no workspace at all.
 *
 * The four directories below are the ones that argued for it: the lanes
 * themselves, Better Auth and the DAL's bootstrap, the outbox and the clock,
 * and the rate limiter whose count has to survive a refused transaction. The
 * list is short on purpose, and this is what keeps it short — §2.2's own
 * precedent is that a boundary this load-bearing is enforced by CI rather than
 * agreed in prose.
 */
const laneBoundary = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: [
    "src/server/db/**",
    "src/server/limits/**",
    "src/server/events/**",
    "src/server/auth/config.ts",
    "src/server/auth/dal.ts",
    "src/app/api/scheduler/route.ts",
    "src/server/modules/automations/routines.ts",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/server/db/client",
            importNames: ["getSystemDatabase", "getDatabase"],
            message:
              "Reach the database through a lane: withTenant, withUser, withInvitation, or writing() for a write action. See ADR 0002.",
          },
        ],
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
  laneBoundary,
  playwrightFixtures,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    // Agent worktrees live here, each with a `.next/` of its own. Their build
    // output is not source, and a lint run that reaches into one reports
    // hundreds of errors in transpiled chunks that nobody wrote.
    ".claude/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Reference material copied from the v1, not source.
    "docs/**",
  ]),
]);

export default eslintConfig;
