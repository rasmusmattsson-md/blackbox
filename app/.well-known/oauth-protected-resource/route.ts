import { auth0Issuer, missingAuth0Config } from "@/lib/auth0";
import { resourceUrl } from "@/lib/config";

export const runtime = "nodejs";

/**
 * RFC 9728 protected resource metadata.
 *
 * This is how Claude finds the authorization server: it reads `resource` to
 * confirm it is talking to the server it thinks it is, then follows
 * `authorization_servers[0]` to Auth0, where it registers itself and runs the
 * login. Only the first entry is used — later ones are not tried.
 *
 * `resource` must equal the URL the user typed into Claude, path included, and
 * it must also be the identifier the Auth0 API is registered under. Both come
 * from `resourceUrl()` so they cannot drift.
 *
 * Nothing here is discovered at runtime. Auth0's issuer is a fact about the
 * configured tenant, so there is no metadata fetch to fail and no reason to
 * answer anything but this document.
 */
export async function GET() {
  const cors = { "Access-Control-Allow-Origin": "*" };

  const missing = missingAuth0Config();
  if (missing.length) {
    return Response.json(
      {
        error: "not_configured",
        error_description: `This deployment is missing ${missing.join(", ")}, so it cannot say where to authorize.`,
      },
      { status: 503, headers: cors },
    );
  }

  return Response.json(
    {
      resource: resourceUrl(),
      authorization_servers: [auth0Issuer()],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email"],
    },
    {
      // Public, unauthenticated, and read by Claude before it holds any
      // credential — CORS has to allow it from anywhere.
      headers: { ...cors, "Cache-Control": "public, max-age=3600" },
    },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
