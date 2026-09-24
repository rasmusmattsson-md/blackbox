import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

/**
 * Auth0's routes, and the session refresh that keeps them usable.
 *
 * `auth0.middleware` mounts /auth/login, /auth/logout, /auth/callback and
 * friends, and rolls the session cookie on every other request. Next 16
 * renamed this file convention from `middleware` to `proxy`; the function must
 * be named for the file.
 *
 * It runs on everything except static assets. In particular it runs on
 * /api/mcp, which has no cookie and needs none — the middleware simply finds no
 * session and passes the request through to a route that authenticates it from
 * the bearer token instead.
 */
export async function proxy(request: NextRequest) {
  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
