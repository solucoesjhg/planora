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
import { newId } from "@/lib/id";
import { getSystemDatabase, type Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { senderFromEnvironment, type EmailSender } from "@/server/email/sender";
import {
  resetPasswordEmail,
  verificationEmail,
} from "@/server/email/templates";
import { ensurePersonalWorkspace } from "@/server/modules/workspaces/repository";
import { DEFAULT_DESTINATION, safeDestination } from "@/lib/nav";
import { VERIFIED_PARAM } from "@/lib/strings";
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
    },
    emailVerification: {
      sendOnSignUp: true,
      // Fifteen minutes rather than the default hour. The link no longer
      // carries a session, so this is an expiry and not a bearer window; it
      // stays short because nothing in a hardening phase should widen.
      expiresIn: 900,
      /**
       * The link confirms the address. It does not sign anybody in.
       *
       * It is a GET that changes state, which is exactly what a mail scanner,
       * a security gateway or a prefetching client follows before the person
       * does — and with this on, whichever of them arrived first got the
       * session cookie. The person's own click then hit the already-verified
       * branch, which returns before any session is created, and they landed
       * on a page the proxy bounced straight back to the login form with
       * nothing to explain it. So the convenience was not even reliable.
       *
       * This is the same shape the invitation flow was given in Phase 9, where
       * accepting became a click rather than a page load, and for the same
       * reason. The cost is one extra step at sign-up, once per account.
       */
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sender.send(
          verificationEmail({
            to: user.email,
            name: user.name,
            // Better Auth defaults the callback to "/", the marketing page.
            // Verification no longer signs anybody in, so the link lands on
            // the login form, which says the address is confirmed and keeps
            // whatever the sign-up was on its way to.
            url: afterVerification(url),
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
    /**
     * The password policy runs before the request that would store it. It
     * checks length, a blocklist of what people actually pick, the person's own
     * name and address, and — best effort — the breach corpus. What it
     * deliberately does not do is demand an uppercase, a digit and a symbol:
     * that rule produces `Senha@123`, which is in every breach list.
     */
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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

        // A reset carries no name or address, only the token; the person is
        // behind it in the verification row, and the policy should refuse
        // their own name in the new password as it does at sign-up.
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
      }),
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

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
 * The fallback is for a developer's own machine and nowhere else. Anything that
 * is not `development` — staging, preview, a container someone forgot to
 * configure — fails loudly rather than signing sessions with a secret that is
 * published in this file.
 */
/**
 * Where the verification link lands: the login form, saying so.
 *
 * Sign-up may have been on its way somewhere specific — the invitation the
 * person was following — and that survives as `next`, so signing in continues
 * the journey instead of dropping them on the dashboard. The proxy would send
 * them to the same place anyway; arriving with the notice is the difference
 * between "confirmed, now sign in" and a login form that appeared for no
 * visible reason.
 */
function afterVerification(url: string): string {
  const parsed = new URL(url);
  const asked = parsed.searchParams.get("callbackURL");

  const login = new URLSearchParams({ [VERIFIED_PARAM]: "1" });
  // The register form always sends a callback, and for most people it is the
  // dashboard — which is where the login form goes anyway. Only somewhere
  // *else* is worth carrying, and carrying nothing keeps the link readable.
  // `safeDestination` is what decides the value is a path here and not another
  // host; the login page checks it again on the way out.
  const destination = safeDestination(asked, DEFAULT_DESTINATION);
  // "/" is what Better Auth substitutes when sign-up names no callback at all,
  // and it is the marketing page — not somewhere to send a person who has just
  // confirmed an address.
  if (destination !== DEFAULT_DESTINATION && destination !== "/") {
    login.set("next", destination);
  }

  parsed.searchParams.set("callbackURL", `/login?${login.toString()}`);
  return parsed.toString();
}

