/**
 * Where this deployment lives, and what its tokens are addressed to.
 *
 * One address, written down once. Four things derive from it and all four have
 * to agree — see `resourceUrl`.
 */

/** The public origin this deployment is reached at. */
export function appUrl(): string | undefined {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  // Vercel sets this on every deployment, so a preview URL works without
  // anybody editing an environment variable to match it.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : undefined;
}

/**
 * The identity of this MCP server, as four strings that must be identical.
 *
 * Claude compares the `resource` we advertise against the URL the user typed;
 * it asks Auth0 for a token for that resource; Auth0 stamps its API identifier
 * into `aud`; we check `aud` on the way in. A mismatch anywhere is not a
 * helpful error — it is a connector that will not connect — so all four read
 * from here, and the Auth0 API must be registered under exactly this string.
 */
export function resourceUrl(): string {
  const explicit = process.env.MCP_RESOURCE_URL;
  if (explicit) return explicit;

  const base = appUrl();
  if (!base) {
    throw new Error(
      "Neither MCP_RESOURCE_URL nor APP_URL is set, so this server cannot say " +
        "which resource its tokens should be issued for.",
    );
  }
  return new URL("/api/mcp", base).toString();
}

/**
 * The `aud` an incoming access token must carry, or null when it is not checked.
 *
 * Defaults to the resource URL, which is what the Auth0 API should be
 * registered as. `AUTH0_AUDIENCE` names something else if the API was
 * registered under a different identifier.
 *
 * `AUTH0_AUDIENCE=none` turns the check off, and that is a real loss rather
 * than a formality: `aud` is what stops a token Auth0 minted for some other
 * API in the same tenant from being replayed here.
 */
export function expectedAudience(): string | null {
  const configured = process.env.AUTH0_AUDIENCE?.trim();
  if (configured === "none") return null;
  return configured || resourceUrl();
}
