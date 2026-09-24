import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { appUrl, resourceUrl } from "./config";

/**
 * Auth0 is the only identity this server has.
 *
 * It plays two parts, which is why this server needs no database of its own:
 *
 *  - **Authorization server.** Claude discovers it from our protected-resource
 *    metadata, registers itself, and sends a bearer token we verify in
 *    lib/mcp-auth.ts.
 *  - **Token vault.** Auth0 keeps Google's refresh token and hands us a fresh
 *    access token on demand. Nothing about Google's credential is ever stored
 *    here — see lib/google.ts. Filling the vault is a *separate step from
 *    logging in*; see `connectAccountPath`.
 *
 * The SDK reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET and
 * AUTH0_SECRET from the environment on its own. What is passed explicitly
 * below is what the defaults would get wrong — including the app's own base
 * URL, which it would otherwise take from a second variable.
 */

/** Google Analytics. One scope covers both reports and the property list. */
export const ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";

/**
 * Where the console sends someone to put their Google grant in the vault.
 *
 * Logging in and connecting are two different flows on this tenant, and that
 * is the single thing most worth knowing about this file. `/auth/login`
 * authenticates — Auth0 learns who you are and stores nothing callable.
 * `/auth/connect` runs the Connect Account flow against Auth0's My Account API,
 * and only that writes a Google refresh token into Token Vault.
 *
 * Verified rather than assumed: after thirteen successful logins the user's
 * `connected_accounts` was still `[]`, and the connection carries
 * `connected_accounts: {active: true}` while the classic
 * `users/{id}/federated-connections-tokensets` route does not exist on this
 * tenant at all. Login was never going to fill it.
 *
 * `scopes` is every Google scope the server needs, not one connector's —
 * there is one Google account and one consent screen behind all of them. The
 * registry works out the union; see `connectPath` in lib/connectors/index.ts.
 */
export function connectAccountPath(scopes: string[]): string {
  const params = new URLSearchParams({
    connection: googleConnection(),
    returnTo: "/",
  });
  // Repeated rather than joined: the SDK reads this with getAll("scopes").
  for (const scope of scopes) params.append("scopes", scope);
  return `/auth/connect?${params}`;
}

/**
 * The Auth0 connection Google lives behind.
 *
 * Named rather than assumed because a tenant can have more than one Google
 * connection, and the token vault is keyed by connection name. `google-oauth2`
 * is what Auth0 calls the built-in one.
 */
export function googleConnection(): string {
  return process.env.AUTH0_CONNECTION?.trim() || "google-oauth2";
}

/**
 * Everything the deployment needs before it can answer anything.
 *
 * Collected as names rather than thrown one at a time: an operator setting this
 * up for the first time should see the whole list at once, on the console's
 * front page and in the MCP endpoint's error body.
 */
export function missingAuth0Config(): string[] {
  return [
    !process.env.AUTH0_DOMAIN?.trim() && "AUTH0_DOMAIN",
    !process.env.AUTH0_CLIENT_ID?.trim() && "AUTH0_CLIENT_ID",
    !process.env.AUTH0_CLIENT_SECRET?.trim() && "AUTH0_CLIENT_SECRET",
    !process.env.AUTH0_SECRET?.trim() && "AUTH0_SECRET",
  ].filter((name): name is string => Boolean(name));
}

/** The issuer, as Auth0 writes it in the `iss` claim — with the trailing slash. */
export function auth0Issuer(): string {
  const domain = process.env.AUTH0_DOMAIN?.trim();
  if (!domain) {
    throw new Error(
      "AUTH0_DOMAIN is not set, so this server cannot say who issues its tokens.",
    );
  }
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/`;
}

/**
 * `audience` is what makes Auth0 mint a JWT for our API rather than an opaque
 * token for its own userinfo endpoint, and it has to match the API identifier
 * registered in the dashboard. We use the MCP resource URL for both, so the
 * value Claude asks for (RFC 8707 `resource`) and the value we check in `aud`
 * are the same string by construction.
 *
 * Resolved lazily: `resourceUrl()` throws when APP_URL is unset, and that must
 * be a request-time error rather than one that fails `next build`.
 */
function apiAudience(): string | undefined {
  try {
    return resourceUrl();
  } catch {
    return undefined;
  }
}

export const auth0 = new Auth0Client({
  /**
   * One address, not two.
   *
   * The SDK would read APP_BASE_URL on its own, which made it possible for the
   * URL the login redirects back to and the URL the audience is built from to
   * disagree. They did, once, and it cost an hour: the console came back to
   * :3000 while asking Auth0 for a token addressed to :3002, and Auth0
   * answered `Service not found` about an API nobody had registered. Deriving
   * both from APP_URL removes the way to get that wrong.
   */
  appBaseUrl: appUrl(),
  /**
   * Mounts /auth/connect. Off by default in the SDK; without it that path 404s
   * rather than saying it is disabled.
   */
  enableConnectAccountEndpoint: true,
  authorizationParameters: {
    /**
     * `offline_access` is not optional here. The token vault exchanges *our*
     * refresh token for Google's access token, so a session without one can
     * read nothing — the failure surfaces much later, as a connected account
     * that cannot be used.
     */
    scope: "openid profile email offline_access",
    audience: apiAudience(),
    /**
     * Straight to Google, skipping Auth0's account picker. This deployment has
     * exactly one thing to log in with, and the identity it wants is the same
     * Google identity whose Analytics it is about to read.
     */
    connection: googleConnection(),
  },
});
