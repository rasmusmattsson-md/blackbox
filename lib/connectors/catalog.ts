import type { GetToken } from "@/lib/google";
import { connectPath, CONNECTORS } from "./index";
import type { ConnectorResource } from "./types";

/** One connector, flattened for the console. */
export interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  connectPath: string;
  connected: boolean;
  account?: string;
  error?: string;
  resources: ConnectorResource[];
}

/**
 * What exists, what is connected, and what each one can point at.
 *
 * Called directly by the page for the first paint and over HTTP by the console
 * after a change, which is why it is here rather than in the route: the server
 * render should not have to make a request to itself to know what it already
 * knows.
 *
 * One connector failing — a revoked grant, an API not enabled — must not blank
 * the whole console, so failures are reported per connector rather than thrown.
 */
export async function catalogFor(
  getToken: GetToken | undefined,
): Promise<ConnectorInfo[]> {
  return Promise.all(
    CONNECTORS.map(async (connector) => {
      const base = {
        id: connector.id,
        name: connector.name,
        description: connector.description,
        // One link for all of them — see `connectPath` in ./index.ts.
        connectPath: connectPath(),
      };

      if (!getToken) return { ...base, connected: false, resources: [] };

      try {
        const status = await connector.status(getToken);
        if (!status.connected) return { ...base, ...status, resources: [] };

        return { ...base, ...status, resources: await connector.resources(getToken) };
      } catch (e) {
        return {
          ...base,
          connected: false,
          resources: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}
