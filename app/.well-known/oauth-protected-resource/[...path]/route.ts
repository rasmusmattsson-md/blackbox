/**
 * The same metadata, served under the MCP server's path.
 *
 * Claude probes `/.well-known/oauth-protected-resource/<mcp-path>` before the
 * bare path, so `/api/mcp` resolves here. Serving both costs nothing and
 * removes one way for discovery to fail silently.
 *
 * `runtime` is declared rather than re-exported: Next reads route segment
 * config statically and rejects a re-export.
 */
export { GET, OPTIONS } from "../route";

export const runtime = "nodejs";
