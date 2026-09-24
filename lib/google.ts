import { auth0, auth0Issuer, googleConnection } from "./auth0";
import { appUrl } from "./config";

/** How a caller proves which Google account it is acting for. */
export type GetToken = () => Promise<string>;

/**
 * How this server gets a Google access token — which is to say, how it doesn't
 * store one.
 *
 * Auth0's token vault holds Google's refresh token. We exchange a token we
 * already hold for a short-lived Google access token, per request. There is no
 * grant table, no encryption key and no refresh logic here, because there is
 * nothing durable to protect: everything this file returns expires on its own.
 *
 * Two callers, two things to exchange, and that is the only real complexity:
 *
 *  - **The console** has a browser session. The SDK does the exchange from the
 *    session's refresh token.
 *  - **The MCP endpoint** has a bearer token minted for a client Claude
 *    registered itself. There is no session and no cookie, so the exchange runs
 *    against that access token directly.
 */

/**
 * The user is signed in but Auth0 has no Google credential for them.
 *
 * Kept distinct from an auth failure because the fix is different: not "sign in
 * again" but "go to the console once and let it connect". The MCP layer turns
 * it into a link the model can pass on rather than an error it can only repeat.
 */
export class MissingGoogleGrantError extends Error {
  /**
   * What Auth0 actually said, kept separate from the advice.
   *
   * The console is the place the message tells an MCP caller to go, so
   * repeating "open the console" there is a loop. It shows this instead — and
   * during setup it is the only visible evidence of which of the half-dozen
   * tenant settings is still wrong.
   */
  readonly detail?: string;

  constructor(detail?: string) {
    const where = connectUrl();
    super(
      (where
        ? `No Google account is connected yet. Open ${where} and connect one, then try again.`
        : "No Google account is connected yet. Open this server's console and connect one, then try again.") +
        (detail ? ` (${detail})` : ""),
    );
    this.name = "MissingGoogleGrantError";
    this.detail = detail;
  }
}

/** Where a user goes to connect their Google account. */
export function connectUrl(): string | undefined {
  const base = appUrl();
  return base ? new URL("/", base).toString() : undefined;
}

/**
 * Auth0's own grant type for vending a federated connection's access token.
 *
 * Not RFC 8693's generic exchange — Auth0 names its own grant and its own
 * requested-token-type, and the token endpoint rejects the standard URNs. These
 * two strings are copied from what @auth0/nextjs-auth0 sends internally
 * (dist/server/auth-client.js); they are the wire contract, not our invention.
 */
const GRANT_TYPE =
  "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token";
const REQUESTED_TOKEN_TYPE =
  "http://auth0.com/oauth/token-type/federated-connection-access-token";
const SUBJECT_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";

/**
 * The Google token for whoever is signed into the console.
 *
 * `getAccessTokenForConnection` reads the session cookie, so this only works
 * inside a request that has one.
 *
 * Memoised per call of this factory, which in practice means per page render.
 * The SDK's own caching writes to the session cookie and a Server Component
 * cannot set cookies — so from `app/page.tsx` the exchange would otherwise run
 * once for `status` and again for `resources`, neither persisting. One promise,
 * shared, is the fix that does not depend on where this is called from.
 */
export function googleTokenForSession(): GetToken {
  let pending: Promise<string> | undefined;

  return () => {
    pending ??= auth0
      .getAccessTokenForConnection({ connection: googleConnection() })
      .then(({ token }) => token)
      .catch((e) => {
        // Not retained: a failure now should not poison a later attempt within
        // the same render, and there is no cheaper way to re-ask.
        pending = undefined;
        throw asGrantError(e);
      });
    return pending;
  };
}

/**
 * The Google token for an MCP caller, exchanged from the token they presented.
 *
 * The console path can lean on the SDK because it has a session to read. This
 * one cannot: the caller is a client Claude registered for itself through DCR,
 * and all we hold is the bearer token it sent. So the exchange is made
 * directly, with Auth0's federated-connection grant and the caller's own access
 * token as the subject — Auth0 resolves it to the same user and vends that
 * user's vaulted Google credential.
 *
 * Auth0's error body is surfaced rather than swallowed. Everything that can go
 * wrong here is tenant configuration, and the difference between "this user has
 * not connected Google" and "this tenant will not perform the exchange" is
 * entirely in that message.
 */
export function googleTokenForAccessToken(accessToken: string): GetToken {
  return async () => {
    const clientId = process.env.AUTH0_CLIENT_ID?.trim();
    const clientSecret = process.env.AUTH0_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error(
        "AUTH0_CLIENT_ID and AUTH0_CLIENT_SECRET must be set for the MCP " +
          "endpoint to exchange a caller's token for a Google one.",
      );
    }

    const res = await fetch(new URL("/oauth/token", auth0Issuer()), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: GRANT_TYPE,
        client_id: clientId,
        client_secret: clientSecret,
        connection: googleConnection(),
        subject_token: accessToken,
        subject_token_type: SUBJECT_TYPE_ACCESS_TOKEN,
        requested_token_type: REQUESTED_TOKEN_TYPE,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !body.access_token) {
      const detail = body.error_description ?? body.error ?? `HTTP ${res.status}`;
      // A user who never connected Google and a tenant that refuses the
      // exchange both land here. Only the first is the caller's to fix, so the
      // reason travels with the message instead of being flattened away.
      throw new MissingGoogleGrantError(detail);
    }

    return body.access_token;
  };
}

/**
 * Turn an SDK failure into the error the console and the model should see.
 *
 * The useful part is never the top-level message. `AccessTokenForConnectionError`
 * says only "there was an error trying to exchange the refresh token" and hangs
 * the real answer — Auth0's own `error` and `error_description` — off `cause` as
 * an `OAuth2Error`. Reading just `.message` throws away the one sentence that
 * distinguishes Token Vault being off from a missing scope from a connection
 * name that does not exist.
 */
function asGrantError(e: unknown): Error {
  const err = e as { code?: string; message?: string; cause?: unknown } | null;
  const cause = err?.cause as { code?: string; message?: string } | undefined;

  // Innermost first: Auth0's code and description, then the SDK's wrapper.
  const detail =
    [cause?.code, cause?.message].filter(Boolean).join(": ") ||
    err?.message ||
    String(e);

  if (
    err?.code === "missing_refresh_token" ||
    err?.code === "failed_to_exchange" ||
    /refresh token|connection/i.test(detail)
  ) {
    return new MissingGoogleGrantError(detail);
  }
  return e instanceof Error ? e : new Error(detail);
}
