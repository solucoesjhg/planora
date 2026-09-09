/**
 * Better Auth (DEVELOPMENT_PLAN.md §5, §7 Phase 3).
 *
 * Sessions live in our own database, the tables are ours, and no third-party
 * SDK reaches the client. Email and password only — social providers are not
 * on the map for v1.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { newId } from "@/lib/id";
import { getDatabase, type Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { senderFromEnvironment, type EmailSender } from "@/server/email/sender";
import {
  resetPasswordEmail,
  verificationEmail,
} from "@/server/email/templates";
import { ensurePersonalWorkspace } from "@/server/modules/workspaces/repository";

export type AuthOptions = {
  readonly database: Database;
  readonly sender: EmailSender;
  readonly baseUrl: string;
  readonly secret: string;
};

export function createAuth({ database, sender, baseUrl, secret }: AuthOptions) {
  return betterAuth({
    baseURL: baseUrl,
    secret,
    database: drizzleAdapter(database, {
      provider: "pg",
      usePlural: true,
      schema,
    }),
    advanced: {
      database: {
        // Same id scheme as every other table: time-ordered UUID v7.
        generateId: () => newId(),
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        await sender.send(
          resetPasswordEmail({ to: user.email, name: user.name, url }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // The link is a JWT that is not single-use: it works for as long as it is
      // valid, and — while autoSignInAfterVerification stays on — clicking it
      // signs the person in. Fifteen minutes rather than the default hour keeps
      // that bearer window short.
      expiresIn: 900,
      // TODO(review): decide whether the verification link should also sign the
      // person in. Turning this off costs one extra step at signup and removes
      // the "link in an inbox is a live credential" property entirely.
      // See docs/STATUS.md, "Open decisions".
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sender.send(
          verificationEmail({ to: user.email, name: user.name, url }),
        );
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Signing up gives you a workspace of your own (§6.1). This hook
            // runs outside the account's transaction, so the DAL repeats the
            // call on first use — both paths are the same idempotent function.
            await ensurePersonalWorkspace(database, {
              id: user.id,
              name: user.name,
              email: user.email,
            });
          },
        },
      },
    },
    /**
     * On by default only in production, counted in memory, which on a
     * serverless deployment means a counter per instance. Both are fixed here:
     * always on, counted in Postgres, and stricter on the endpoints worth
     * attacking than on session reads.
     */
    rateLimit: {
      enabled: true,
      storage: "database",
      // The model is `rateLimit`; `usePlural` maps it onto the `rateLimits`
      // table. Naming it in the plural here makes the adapter pluralize twice.
      window: 10,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 5 },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

/** Built on first use, so importing this module never opens a connection. */
export function getAuth(): Auth {
  if (instance) return instance;

  instance = createAuth({
    database: getDatabase(),
    sender: senderFromEnvironment(),
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: requireSecret(),
  });

  return instance;
}

/**
 * The fallback is for a developer's own machine and nowhere else. Anything that
 * is not `development` — staging, preview, a container someone forgot to
 * configure — fails loudly rather than signing sessions with a secret that is
 * published in this file.
 */
function requireSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters outside development",
    );
  }

  return "planora-development-secret-planora-development-secret";
}
