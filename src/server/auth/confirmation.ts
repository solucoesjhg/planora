/**
 * Confirming an address takes the mailbox and the password together (ADR 0007).
 *
 * Better Auth confirms an address when its link is opened: whoever holds the
 * mailbox confirms whatever account carries the address, with whatever
 * password that account was given. Somebody who signed up first with another
 * person's address, and a password of their own, only had to wait for the
 * owner to open a link — and the owner's own sign-up sent nothing, so the
 * "Reenviar" button handed them exactly that link.
 *
 * Here the link confirms nothing. It carries a token to the login form, and
 * the address is confirmed when that token arrives with the account's own
 * password. A password somebody else chose cannot be typed by the person
 * holding the mailbox, and the mailbox cannot be opened by the person who
 * chose it.
 */

import { createAuthMiddleware } from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";

export type Confirmation = { readonly email: string };

/**
 * The address a confirmation token was issued for, or nothing: a token that
 * is missing, forged, expired, or issued for something else (a change of
 * address carries `updateTo`, and this flow never issues one).
 */
export async function readConfirmation(
  token: unknown,
  secret: string,
): Promise<Confirmation | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return null;
  }

  const payload = await verifyJWT(token, secret);
  if (!payload || typeof payload["email"] !== "string") return null;
  if (payload["updateTo"] !== undefined) return null;

  return { email: payload["email"].toLowerCase() };
}

/** Better Auth's context, as a hook receives it. */
type AuthContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]["context"];

/**
 * Runs before sign-in. When the token was issued for the address being signed
 * in to, and the password is the account's own, the address is confirmed —
 * and sign-in, which checks the password again, goes ahead with it.
 *
 * Anything else leaves the account as it was and says nothing: sign-in then
 * answers on its own, "wrong password" or "not confirmed", and the second one
 * sends a fresh link to the mailbox.
 */
export async function confirmBeforeSignIn(
  context: AuthContext,
  token: unknown,
  credentials: { email?: unknown; password?: unknown },
): Promise<void> {
  const { email, password } = credentials;
  if (typeof email !== "string" || typeof password !== "string") return;

  const confirmation = await readConfirmation(token, context.secret);
  if (!confirmation || confirmation.email !== email.toLowerCase()) return;

  const found = await context.internalAdapter.findUserByEmail(confirmation.email, {
    includeAccounts: true,
  });
  if (!found || found.user.emailVerified) return;

  const credential = found.accounts.find(
    (account) => account.providerId === "credential" && account.accountId === found.user.id,
  );
  if (!credential?.password) return;

  const matches = await context.password.verify({ hash: credential.password, password });
  if (!matches) return;

  await context.internalAdapter.updateUserByEmail(confirmation.email, { emailVerified: true });
}
