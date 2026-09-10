/**
 * The signing secret, resolved once.
 *
 * Better Auth signs sessions and verification links with it, and the filesystem
 * storage adapter signs its file URLs with it. They must agree: two fallbacks
 * would mean a link signed with one key and checked against another, which
 * fails as a 403 that looks like an expiry.
 */

const DEVELOPMENT_FALLBACK =
  "planora-development-secret-planora-development-secret";

export function authSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env["BETTER_AUTH_SECRET"];
  if (secret && secret.length >= 32) return secret;

  if (env["NODE_ENV"] !== "development") {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters outside development",
    );
  }

  return DEVELOPMENT_FALLBACK;
}
