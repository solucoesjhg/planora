/**
 * Better Auth (DEVELOPMENT_PLAN.md §5, §7 Phase 3).
 *
 * Sessions live in our own database, the tables are ours, and no third-party
 * SDK reaches the client. Email and password only — social providers are not
 * on the map for v1.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { CONFIRMATION_HEADER, confirmationPath } from "@/lib/confirmation-link";
import { newId } from "@/lib/id";
import { getSystemDatabase, type Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { senderFromEnvironment, type EmailSender } from "@/server/email/sender";
import {
  existingAccountEmail,
  resetPasswordEmail,
  verificationEmail,
} from "@/server/email/templates";
import { ensurePersonalWorkspace } from "@/server/modules/workspaces/repository";
import { confirmBeforeSignIn } from "./confirmation";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MESSAGES,
  checkPassword,
} from "./password-policy";
import { authSecret } from "./secret";

/** The endpoints that accept a password Better Auth is about to store. */
const PASSWORD_PATHS = ["/sign-up/email", "/change-password", "/reset-password"];

/** How long a password-reset link works, in seconds. The email says so too. */
export const RESET_TOKEN_TTL = 3600;

export type AuthOptions = {
  readonly database: Database;
  readonly sender: EmailSender;
  readonly baseUrl: string;
  readonly secret: string;
  /**
   * The breach check reaches api.pwnedpasswords.com. Tests turn it off so the
   * suite neither depends on the network nor spends somebody else's quota.
   */
  readonly checkBreaches?: boolean;
};

export function createAuth({
  database,
  sender,
  baseUrl,
  secret,
  checkBreaches = true,
}: AuthOptions) {
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
      /**
       * Who the rate limiter is counting.
       *
       * Behind a proxy the socket address is the proxy's, and when Better Auth
       * cannot resolve a client it falls back to **one shared bucket for
       * everybody** — which would make sign-up five per minute for the whole
       * deployment, not per person. Vercel sets `x-vercel-forwarded-for`
       * itself and strips any copy the client sent, so it is the one worth
       * trusting there; `x-forwarded-for` is the fallback everywhere else.
       */
      ipAddress: {
        ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      /**
       * Password recovery. The token is 24 random characters stored in
       * `verifications` and consumed on use — unlike the verification link,
       * it works once. Whoever held a session on the old password loses it: a
       * reset is most often a person taking their account back.
       */
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sender.send(
          resetPasswordEmail({ to: user.email, name: user.name, url }),
        );
      },
      /**
       * The reset link was delivered to the mailbox, and the password is the
       * one the person holding it just chose — which is everything confirming
       * an address asks for (ADR 0007). It is also how the owner of an address
       * takes it back from an account somebody else created with it: the
       * stranger's password stops working in the same step.
       */
      onPasswordReset: async ({ user }) => {
        await database
          .update(schema.users)
          .set({ emailVerified: true, updatedAt: new Date() })
          .where(and(eq(schema.users.id, user.id), eq(schema.users.emailVerified, false)));
      },
      /**
       * Sign-up with an address that already has an account answers exactly as
       * it does for a new one, so that it does not tell a stranger which
       * addresses exist. It used to send nothing at all: the owner of the
       * address waited for a message that never came, and "Reenviar" sent them
       * a link to an account somebody else had created with it (ADR 0007).
       * Now the mailbox hears about it.
       */
      onExistingUserSignUp: async ({ user }) => {
        await sender.send(
          existingAccountEmail({ to: user.email, url: new URL("/login", baseUrl).toString() }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      /**
       * Signing in to an account nobody has confirmed sends a fresh link — but
       * only once the password was right, so it is the account's owner asking,
       * and a link that expired is never a dead end.
       */
      sendOnSignIn: true,
      // Fifteen minutes rather than the default hour. The link confirms
      // nothing on its own, so this is an expiry and not a bearer window; it
      // stays short because nothing in a hardening phase should widen.
      expiresIn: 900,
      /**
       * Better Auth's own link — a GET to `/verify-email` — never runs: the
       * hook below turns it into the login form (ADR 0007). This stays off in
       * case it ever does: it would hand a session to whichever mail scanner
       * followed the link first.
       */
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }) => {
        await sender.send(
          verificationEmail({
            to: user.email,
            name: user.name,
            // The login form, carrying the token and wherever sign-up was on
            // its way to — the invitation the person was following, most
            // often. Signing in there is what confirms the address.
            url: confirmationUrl(url, token),
          }),
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
        // Ten a minute is plenty for honest retries at a refused password and
        // nothing at all against a 24-character token.
        "/reset-password": { window: 60, max: 10 },
        "/send-verification-email": { window: 60, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        /**
         * The confirmation link is no longer Better Auth's to follow. One sent
         * before ADR 0007 still points here; it lands where a new one does,
         * and confirms nothing on the way.
         */
        if (ctx.path === "/verify-email") {
          throw ctx.redirect(confirmationPath(ctx.query?.token, ctx.query?.callbackURL));
        }

        if (ctx.path === "/sign-in/email") {
          const token = ctx.headers?.get(CONFIRMATION_HEADER);
          if (token) await confirmBeforeSignIn(ctx.context, token, ctx.body ?? {});
          return;
        }

        await holdToPasswordPolicy(ctx, checkBreaches);
      }),
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * The password policy runs before the request that would store it. It checks
 * length, a blocklist of what people actually pick, the person's own name and
 * address, and — best effort — the breach corpus. What it deliberately does
 * not do is demand an uppercase, a digit and a symbol: that rule produces
 * `Senha@123`, which is in every breach list.
 */
async function holdToPasswordPolicy(ctx: HookContext, checkBreaches: boolean): Promise<void> {
  if (!PASSWORD_PATHS.includes(ctx.path)) return;

  const body = (ctx.body ?? {}) as {
    password?: string;
    newPassword?: string;
    email?: string;
    name?: string;
    token?: string;
  };
  const password = body.newPassword ?? body.password;
  if (!password) return;

  // A reset carries no name or address, only the token; the person is behind
  // it in the verification row, and the policy should refuse their own name in
  // the new password as it does at sign-up.
  const identity =
    ctx.path === "/reset-password"
      ? await identityBehindResetToken(ctx, body.token ?? ctx.query?.token)
      : { email: body.email, name: body.name };

  const decision = await checkPassword(password, identity, { checkBreaches });

  if (decision.kind === "refused") {
    throw new APIError("BAD_REQUEST", {
      message: PASSWORD_MESSAGES[decision.reason],
      code: "WEAK_PASSWORD",
    });
  }
}

/**
 * Who a reset token belongs to, read the way the endpoint reads it: the
 * verification row holds the user id. A token that is missing, unknown or
 * expired yields nobody — the endpoint refuses it a moment later with its own
 * message, and there is nothing to say about a password that will not be
 * stored.
 */
async function identityBehindResetToken(
  ctx: HookContext,
  token: unknown,
): Promise<{ email?: string; name?: string }> {
  if (typeof token !== "string" || token.length === 0) return {};
  const verification = await ctx.context.internalAdapter.findVerificationValue(
    `reset-password:${token}`,
  );
  if (!verification || verification.expiresAt < new Date()) return {};
  const user = await ctx.context.internalAdapter.findUserById(verification.value);
  return user ? { email: user.email, name: user.name } : {};
}

let instance: Auth | null = null;

/** Built on first use, so importing this module never opens a connection. */
export function getAuth(): Auth {
  if (instance) return instance;

  instance = createAuth({
    database: getSystemDatabase(),
    sender: senderFromEnvironment(),
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: authSecret(),
    // The E2E suite turns the breach lookup off so it stays hermetic.
    checkBreaches: process.env["DISABLE_BREACH_CHECK"] !== "1",
  });

  return instance;
}

/**
 * The link the verification message carries: the login form with the token,
 * on the same origin as the link Better Auth built. Better Auth's link names
 * the callback sign-up asked for — the register form always sends one — and
 * that survives as `next`.
 */
function confirmationUrl(url: string, token: string): string {
  const built = new URL(url);
  return new URL(
    confirmationPath(token, built.searchParams.get("callbackURL")),
    built.origin,
  ).toString();
}
