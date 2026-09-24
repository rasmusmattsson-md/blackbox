import { createRemoteJWKSet, jwtVerify } from "jose";
import { auth0Issuer } from "@/lib/auth0";
import { expectedAudience, resourceUrl } from "@/lib/config";

/**
 * The resource-server half of MCP authorization: is this caller real, and what
 * token did they present?
 *
 * The token is the point. Nothing here is stored or looked up — the verified
 * bearer token is itself what gets exchanged for a Google one, so the subject
 * is carried only for log lines.
 */

export interface Caller {
  /** Auth0's id for this user. Diagnostic only; nothing is keyed by it. */
  subject: string;
  /** The verified bearer token, which is also the credential we exchange. */
  accessToken: string;
  scopes: string[];
  clientId?: string;
  expiresAt?: number;
}

/**
 * JWKS is fetched over the network and cached by `jose`, so the set is built
 * once per process rather than per request — otherwise every tool call would
 * pay for a key fetch, and Claude gives the whole exchange ten seconds.
 */
let keys: ReturnType<typeof createRemoteJWKSet> | undefined;

function keySet() {
  if (!keys) keys = createRemoteJWKSet(new URL(".well-known/jwks.json", auth0Issuer()));
  return keys;
}

/** Said once per process, not per request: it is a fact about the deployment. */
let warnedAboutAudience = false;

async function verifyAccessToken(token: string): Promise<Caller | null> {
  const audience = expectedAudience();
  if (!audience && !warnedAboutAudience) {
    warnedAboutAudience = true;
    console.warn(
      "[mcp] AUTH0_AUDIENCE=none: incoming tokens are accepted without an " +
        "`aud` check, so any token this tenant minted for any API will be " +
        "accepted here.",
    );
  }

  try {
    const { payload } = await jwtVerify(token, keySet(), {
      issuer: auth0Issuer(),
      ...(audience ? { audience } : {}),
    });

    if (typeof payload.sub !== "string" || !payload.sub) return null;

    const scope = payload.scope;
    return {
      subject: payload.sub,
      accessToken: token,
      scopes: typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
      clientId: typeof payload.azp === "string" ? payload.azp : undefined,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

/** The caller behind this request, or null if there isn't a verified one. */
export async function verifyRequest(req: Request): Promise<Caller | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  return bearer ? verifyAccessToken(bearer) : null;
}

/**
 * The 401 body and headers for an unauthenticated request.
 *
 * `WWW-Authenticate` is what tells Claude to go and find an authorization
 * server. RFC 9728 puts the resource's own path after the well-known segment,
 * so a resource at /api/mcp advertises its metadata at
 * /.well-known/oauth-protected-resource/api/mcp. Claude probes that form first
 * and the bare path second; both are served, but the pointer we hand out
 * should be the one the spec names.
 */
export function unauthorized(): Response {
  const resource = new URL(resourceUrl());
  const metadata = new URL(
    `/.well-known/oauth-protected-resource${resource.pathname}`,
    resource.origin,
  );

  const challenge = [
    'Bearer error="unauthorized"',
    'error_description="Authorization required"',
    `resource_metadata="${metadata.toString()}"`,
  ].join(", ");

  return Response.json(
    { error: "unauthorized", error_description: "Authorization required" },
    { status: 401, headers: { "WWW-Authenticate": challenge } },
  );
}

/**
 * What an authenticated tool call looks like, as far as a connector cares.
 *
 * Narrowed by hand rather than imported: the SDK's callback context is a large
 * generic, and all a connector needs from it is the token this request was
 * verified as carrying.
 */
export interface CallContext {
  http?: { authInfo?: { token?: string } };
}

/**
 * The verified token behind this tool call.
 *
 * Throws rather than returning null. A tool call that reached this point was
 * authenticated by the route, so a missing token is not a caller without
 * credentials — it is our own plumbing having failed, and serving somebody's
 * analytics while unable to say whose is the one outcome worth crashing over.
 */
export function tokenOf(ctx: CallContext | undefined): string {
  const token = ctx?.http?.authInfo?.token;
  if (typeof token !== "string" || !token) {
    throw new Error(
      "Authenticated request carries no access token. The MCP route must put " +
        "the verified caller's token in `req.auth.token`.",
    );
  }
  return token;
}
