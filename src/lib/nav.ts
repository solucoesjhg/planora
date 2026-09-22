/**
 * Which rail entry a path belongs to.
 *
 * The plain prefix rule lit "Projetos" for /projects/:id — which is the very
 * screen "Quadro" opens — so clicking Quadro landed on a page where Quadro was
 * dark and Projetos was lit, and the button looked broken. The list is
 * /projects alone; anything under a project id is a board, or a task open over
 * one, and both belong to Quadro.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/board") {
    return pathname === "/board" || pathname.startsWith("/projects/");
  }
  if (href === "/projects") {
    return pathname === "/projects";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Where somebody lands when there is nowhere better to send them. */
export const DEFAULT_DESTINATION = "/dashboard";

/**
 * The origin a candidate destination is resolved against. It is deliberately
 * unreachable: nothing fetches it, and a value that resolves anywhere else has
 * left this site.
 */
const INTERNAL = "https://planora.invalid";

/**
 * A destination that came in over the wire, made safe.
 *
 * `/login?next=…` and `/register?next=…` decide where somebody goes after
 * signing in, and since Phase 10 the verification link feeds the same
 * parameter. Both pages used to accept anything starting with a slash, which
 * is not the same thing as a path on this site: a browser reads `//evil.com`
 * and `/\evil.com` as absolute URLs on another host, so either one turned the
 * login form into an open redirect — and a redirect that arrives straight
 * after a real sign-in is exactly the one a person trusts.
 *
 * Resolving the value and comparing origins is what settles it, rather than a
 * list of prefixes to forbid that the next browser quirk gets around.
 */
export function safeDestination(
  value: unknown,
  fallback = DEFAULT_DESTINATION,
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(value, INTERNAL);
  } catch {
    return fallback;
  }

  if (resolved.origin !== INTERNAL) return fallback;

  // Check the string we are about to hand back, not the URL we parsed. They
  // are not the same value: `/..//evil.example` resolves to an internal origin
  // because the `..` is consumed on the way, and then *serialises* to
  // `//evil.example`, which whoever receives it resolves somewhere else
  // entirely. One more resolution is what closes that.
  const destination = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  try {
    if (new URL(destination, INTERNAL).origin !== INTERNAL) return fallback;
  } catch {
    return fallback;
  }

  return destination;
}
