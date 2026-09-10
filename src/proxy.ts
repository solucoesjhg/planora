/**
 * Proxy — what Next 15 called middleware (DEVELOPMENT_PLAN.md §2.5).
 *
 * It reads the session cookie and redirects visitors. Nothing more: the
 * framework's own guidance is that this is an optimistic check, and that real
 * authorization belongs in the DAL, next to the data. A cookie proves someone
 * signed in once, not that the session is still valid.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED = [
  "/dashboard",
  "/projects",
  "/board",
  "/files",
  "/users",
  "/assistant",
  "/settings",
  "/invitations",
];
const AUTH_PAGES = ["/login", "/register"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const signedIn = getSessionCookie(request) !== null;

  if (!signedIn && PROTECTED.some((path) => pathname.startsWith(path))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (signedIn && AUTH_PAGES.some((path) => pathname.startsWith(path))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/board/:path*",
    "/files/:path*",
    "/users/:path*",
    "/assistant/:path*",
    "/settings/:path*",
    "/invitations/:path*",
    "/login",
    "/register",
  ],
};
