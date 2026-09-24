import type { McpServer } from "@modelcontextprotocol/server";
import { MissingGoogleGrantError, type GetToken } from "@/lib/google";

/**
 * One thing inside a connector that the model can query — a GA4 property
 * today, a Search Console site or an ad account later.
 */
export interface ConnectorResource {
  id: string;
  name: string;
  /** Optional heading the console groups by, e.g. the GA4 account name. */
  group?: string;
}

export interface ConnectorStatus {
  connected: boolean;
  /** Which account is connected, for display in the console. */
  account?: string;
  /** Why the connection could not be used, if it could not. */
  error?: string;
}

/**
 * A connector is one data source this server can expose over MCP.
 *
 * Adding a source is one file here plus one line in `index.ts`. Nothing in the
 * MCP route or the console changes: the route calls `register` on everything in
 * the registry, and the console is built from `status` and `resources`.
 *
 * Note what `register` is *not* given: a credential. Tools are registered once
 * per request-scoped server, but the credential they need belongs to the
 * caller, so each tool resolves its own from the call context with `tokenOf`.
 * Binding an account at registration time is how a server ends up serving the
 * wrong one.
 *
 * `status` and `resources` are the console's half, where there is a session and
 * therefore one known account. They take a `GetToken` rather than a user id
 * because nothing here is stored per user any more — the credential is vended
 * on demand and expires on its own.
 */
export interface Connector {
  id: string;
  name: string;
  /** One line shown in the console. */
  description: string;
  /**
   * The Google scopes this connector needs.
   *
   * Declared here rather than at the connect link, because there is one Google
   * account behind every connector and therefore one consent screen. The
   * registry asks for the union — see `connectPath` in ./index.ts.
   */
  scopes: string[];
  /** What the model should know about this source, for the MCP server's instructions. */
  instructions: string;
  /** Whether the underlying account is connected at all. */
  status(getToken: GetToken): Promise<ConnectorStatus>;
  /** Everything the connected account can point at. Empty when not connected. */
  resources(getToken: GetToken): Promise<ConnectorResource[]>;
  /** Register this connector's tools on a request-scoped MCP server. */
  register(server: McpServer): void;
}

/**
 * Turn "can this connector read anything?" into a status the console can show.
 *
 * The check is a real API call rather than a token request: every connector
 * reads the same Google account, so holding a token says nothing about whether
 * it carries *this* connector's scope. A half-scoped account would otherwise
 * show every card connected and fail at the first tool call.
 *
 * Not being connected is not an error. It is the state every deployment starts
 * in, and a card that says "Anslut" already communicates it — printing
 * `federated_connection_refresh_token_not_found` next to the button tells the
 * user nothing they can act on and makes a working install look broken. The
 * detail still goes to the server log, where whoever is setting this up will
 * look. Genuine faults — an API not enabled, a revoked grant — do reach the UI,
 * because those need a human to go and fix something.
 */
export async function statusOf(
  id: string,
  check: () => Promise<unknown>,
): Promise<ConnectorStatus> {
  try {
    await check();
    return { connected: true };
  } catch (e) {
    if (e instanceof MissingGoogleGrantError) {
      console.warn(`[${id}] not connected: ${e.detail ?? e.message}`);
      return { connected: false };
    }
    return {
      connected: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
