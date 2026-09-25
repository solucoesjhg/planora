/**
 * Better Auth (DEVELOPMENT_PLAN.md §5, §7 Phase 3).
 *
 * Sessions live in our own database, the tables are ours, and no third-party
 * SDK reaches the client. Email and password only — social providers are not
 * on the map for v1.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getIP } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import {
  type Identity,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/domain/passwords";
import { CONFIRMATION_HEADER, confirmationPath } from "@/lib/confirmation-link";
import { newId } from "@/lib/id";
import { PASSWORD_CHECK_PATH } from "@/lib/password-check";
import { isRefused } from "@/lib/result";
import { PASSWORD_REFUSALS, SIGN_UP_RATE_LIMITED } from "@/lib/strings";
import { getSystemDatabase, type Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { senderFromEnvironment, type EmailSender } from "@/server/email/sender";
import {
  existingAccountEmail,
  resetPasswordEmail,
  verificationEmail,
} from "@/server/email/templates";
import { ensurePersonalWorkspace } from "@/server/modules/workspaces/repository";
import { consumeAllowance } from "@/server/limits";
import { confirmBeforeSignIn } from "./confirmation";
import { passwordCheck } from "./password-check";
import { type BreachLookup, checkPassword } from "./password-policy";
import { authSecret } from "./secret";

/** How long a password-reset link works, in seconds. The email says so too. */
export const RESET_TOKEN_TTL = 3600;

export type AuthOptions = {
  readonly database: Database;
  readonly sender: EmailSender;
  readonly baseUrl: string;
  readonly secret: string;
  /**
   * The breach check reaches api.pwnedpasswords.com. Tests turn it off so the
   * suite neither depends on the network nor spends somebody else's quota —
   * or hand it a corpus of their own through `fetchBreaches`.
   */
  readonly checkBreaches?: boolean;
  readonly fetchBreaches?: typeof fetch;
};

export function createAuth({
  database,
  sender,
  baseUrl,
  secret,
  checkBreaches = true,
  fetchBreaches,
}: AuthOptions) {
  const policy: PasswordPolicy = {
    database,
    checkBreaches,
    lookup: fetchBreaches ? { fetch: fetchBreaches } : {},
  };

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
      maxPasswordLength: MAX_PASSWORD_LENGTH,
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
        /**
         * Only an outer bound against scripts. Better Auth counts a request
         * here before the body is read, and cannot give a count back, so a
         * refused password used to spend one of five attempts a minute — and
         * since its window restarts on every request, a person who kept
         * trying never got out (ADR 0008). The real allowance, five accounts a
         * minute, is Planora's own and is spent after the password policy, in
         * the hook below. The form never sends a password it knows is
         * refused, so a person does not reach sixty.
         */
        "/sign-up/email": { window: 60, max: 60 },
        // The live check the forms call as the person types (ADR 0008). A
        // debounced field sends a few a minute; a refusal here only means the
        // form says it could not check, and the submit decides.
        [PASSWORD_CHECK_PATH]: { window: 60, max: 60 },
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

        if (ctx.path === "/sign-up/email") return admitSignUp(ctx, policy);

        if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
          return holdNewPasswordToPolicy(ctx, policy);
        }
      }),
    },
    // Before nextCookies(), which has to stay last.
    plugins: [passwordCheck(policy), nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

type PasswordPolicy = {
  readonly database: Database;
  readonly checkBreaches: boolean;
  readonly lookup: BreachLookup;
};

/**
 * The password policy runs before the request that would store it
 * (`src/domain/passwords.ts`, ADR 0008). It checks length, a blocklist of what
 * people actually pick, the person's own name and address, and — best effort —
 * whether the breach corpus shows many people chose it. What it deliberately
 * does not do is demand an uppercase, a digit and a symbol: that rule produces
 * `Senha@123`, which is in every breach list.
 */
async function refuseWeakPassword(
  password: string,
  identity: Identity,
  policy: PasswordPolicy,
): Promise<void> {
  const decision = await checkPassword(password, identity, {
    checkBreaches: policy.checkBreaches,
    ...policy.lookup,
  });

  if (isRefused(decision)) {
    throw new APIError("BAD_REQUEST", {
      message: PASSWORD_REFUSALS[decision.reason],
      code: "WEAK_PASSWORD",
    });
  }
}

/**
 * Sign-up, in the order that makes a refusal free (ADR 0008).
 *
 * 1. The password sign-up stores is `body.password`, and that is the one
 *    judged. The hook used to judge `newPassword ?? password` for every path;
 *    sign-up accepts extra keys, so a weak `password` sent beside a strong
 *    `newPassword` was stored unjudged.
 * 2. A cross-site request is refused before it costs anything. The endpoint's
 *    own CSRF check refuses it too, but only after this hook — by then a
 *    hostile page would have spent its visitor's allowance.
 * 3. The policy. A refusal throws here, and nothing has been counted.
 * 4. The allowance: five accepted sign-ups a minute per connection, which is
 *    what bounds accounts and the messages sign-up sends. A call from the
 *    server itself, with no request, is not counted — as Better Auth's own
 *    limiter does not count it.
 */
async function admitSignUp(ctx: HookContext, policy: PasswordPolicy): Promise<void> {
  const body = (ctx.body ?? {}) as { password?: unknown; email?: unknown; name?: unknown };
  // Not a string: Better Auth refuses it on its own a moment later.
  if (typeof body.password !== "string") return;

  if (ctx.request?.headers.get("sec-fetch-site") === "cross-site") {
    throw new APIError("FORBIDDEN", { message: "Invalid origin", code: "INVALID_ORIGIN" });
  }

  await refuseWeakPassword(
    body.password,
    { email: stringOrNothing(body.email), name: stringOrNothing(body.name) },
    policy,
  );

  const source = ctx.request ?? ctx.headers;
  if (!source) return;

  // The address Better Auth's own limiter counts, resolved the same way. When
  // it cannot be resolved, every such request shares one key — closed rather
  // than open, as Better Auth does.
  const address = getIP(source, ctx.context.options) ?? "unresolved";
  const allowance = await consumeAllowance("signUp", address, Date.now(), policy.database);

  if (isRefused(allowance)) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: SIGN_UP_RATE_LIMITED,
      code: "RATE_LIMITED",
    });
  }
}

/**
 * Reset and change: the password stored is `body.newPassword`, and that is the
 * one judged. A reset carries no name or address, only the token; the person
 * is behind it in the verification row, and the policy refuses their own name
 * in the new password as it does at sign-up. The token is read the way the
 * endpoint reads it — the body's, unless empty, then the query's — so an empty
 * one in the body cannot hide the real one from the policy.
 *
 * The reset keeps Better Auth's counted limit: it is what guards the link's
 * token, and the policy's answer there depends on whose token it is.
 */
async function holdNewPasswordToPolicy(ctx: HookContext, policy: PasswordPolicy): Promise<void> {
  const body = (ctx.body ?? {}) as { newPassword?: unknown; token?: unknown };
  if (typeof body.newPassword !== "string") return;

  const identity =
    ctx.path === "/reset-password"
      ? await identityBehindResetToken(ctx, body.token || ctx.query?.token)
      : {};

  await refuseWeakPassword(body.newPassword, identity, policy);
}

function stringOrNothing(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

  const disableBreachCheck = process.env["DISABLE_BREACH_CHECK"] === "1";
  // The E2E suite turns the breach lookup off so it stays hermetic. A
  // production deployment that inherited the switch would silently accept the
  // most leaked passwords there are, so it refuses to start instead.
  if (disableBreachCheck && process.env["VERCEL_ENV"] === "production") {
    throw new Error("DISABLE_BREACH_CHECK must not be set in production");
  }

  instance = createAuth({
    database: getSystemDatabase(),
    sender: senderFromEnvironment(),
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: authSecret(),
    checkBreaches: !disableBreachCheck,
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
