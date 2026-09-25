/**
 * Where the confirmation link lands (ADR 0007).
 *
 * The link is not what confirms an address: signing in with it is. So it
 * points at the login form, carrying the token for the form to send along with
 * the password, and — when sign-up was on its way somewhere specific, most
 * often an invitation — that destination as `next`.
 */

import { DEFAULT_DESTINATION, safeDestination } from "./nav";

/** The query parameter the login form reads the token from. */
export const CONFIRMATION_PARAM = "confirmar";

/** The request header the login form sends the token in. */
export const CONFIRMATION_HEADER = "x-planora-confirmation";

export function confirmationPath(token: unknown, callbackURL: unknown): string {
  if (typeof token !== "string" || token.length === 0) return "/login";

  const params = new URLSearchParams({ [CONFIRMATION_PARAM]: token });
  // `safeDestination` decides the value is a path on this site; the login page
  // checks it again on the way out. The dashboard is where the form goes
  // anyway, "/" is what Better Auth substitutes when sign-up named nothing (the
  // marketing page), and the login form itself is no destination at all — a
  // link issued before ADR 0007 carries exactly that.
  const destination = safeDestination(callbackURL, DEFAULT_DESTINATION);
  if (
    destination !== DEFAULT_DESTINATION &&
    destination !== "/" &&
    !destination.startsWith("/login")
  ) {
    params.set("next", destination);
  }

  return `/login?${params.toString()}`;
}
