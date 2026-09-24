import { createMcpHandler } from "mcp-handler";
import { unauthorized, verifyRequest } from "@/lib/mcp-auth";
import { missingAuth0Config } from "@/lib/auth0";
import { instructions, registerAll } from "@/lib/connectors";

// `jose` and the token exchange want the Node runtime.
export const runtime = "nodejs";
// A wide report over a long date range is a slow Google call, and the default
// would cut it off.
export const maxDuration = 120;

const handler = createMcpHandler(registerAll, {
  serverInfo: { name: "blackbox-mcp", version: "1.0.0" },
  // Whether a given client shows this to the model is up to the client, so it
  // repeats the guidance rather than being the only place it lives.
  instructions: instructions(),
  verboseLogs: process.env.NODE_ENV !== "production",
});

/**
 * What this endpoint cannot run without.
 *
 * Checked per request, not at module scope: a route module is loaded during
 * `next build`, long before any of these are set, and a throw up there would
 * fail the build rather than the request.
 *
 * Reported rather than thrown, so an operator gets the names of what is missing
 * instead of a blank 500. Without Auth0 configured in particular, every request
 * would fail verification and come back as a 401 telling the caller to
 * authorize — against an authorization server that was never set up. That is an
 * operator problem wearing a user problem's clothes.
 */
function missingConfig(): string[] {
  return missingAuth0Config();
}

async function mcp(req: Request): Promise<Response> {
  const missing = missingConfig();
  if (missing.length) {
    const detail = `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not set`;
    console.error(`[mcp] refusing requests: ${detail}.`);
    return Response.json(
      {
        error: "server_misconfigured",
        error_description:
          `This MCP server is not configured to serve requests: ${detail}. ` +
          "See .env.example.",
      },
      { status: 500 },
    );
  }

  const caller = await verifyRequest(req);
  if (!caller) return unauthorized();

  // `token` is the contract with `tokenOf` in lib/mcp-auth.ts. It is not just
  // an identifier here: Auth0 exchanges this exact token for the caller's
  // Google one, so the credential that reaches a tool is derived from what the
  // caller presented rather than from anything this server stored.
  //
  // Assigned onto the request because that is how the handler takes it: it
  // reads `req.auth` and hands it to the SDK as the call context's `authInfo`.
  req.auth = {
    token: caller.accessToken,
    clientId: caller.clientId ?? "",
    scopes: caller.scopes,
    expiresAt: caller.expiresAt,
    extra: { sub: caller.subject },
  };

  return handler(req);
}

export { mcp as GET, mcp as POST, mcp as DELETE };
