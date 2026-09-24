import type { McpServer } from "@modelcontextprotocol/server";
import { connectAccountPath } from "@/lib/auth0";
import { bigQueryConnector } from "./bigquery";
import { ga4Connector } from "./ga4";
import type { Connector } from "./types";

/** Register new data sources here. Nothing else needs to change. */
export const CONNECTORS: Connector[] = [ga4Connector, bigQueryConnector];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/**
 * One connect link for every connector, asking for every scope.
 *
 * There is a single Google account behind all of this, so there is a single
 * connected account in Auth0's token vault and a single Google consent screen.
 * Asking for the union means one trip through consent leaves every card
 * working; asking per connector would risk the second connect replacing the
 * first one's scopes and quietly breaking a card that had been green.
 *
 * So both cards link to the same place. That is not a bug in the console — it
 * is what one account across two data sources looks like.
 */
export function connectPath(): string {
  const scopes = [...new Set(CONNECTORS.flatMap((c) => c.scopes))];
  return connectAccountPath(scopes);
}

/** Put every connector's tools on a request-scoped server. */
export function registerAll(server: McpServer): void {
  for (const connector of CONNECTORS) connector.register(server);
}

/**
 * What the model is told about this server, built from whatever is registered.
 *
 * Hardcoding one connector's guidance here was fine with one connector and
 * actively misleading with two — a client showing these instructions would
 * have described only Analytics while advertising BigQuery tools.
 */
export function instructions(): string {
  return CONNECTORS.map((c) => c.instructions).join("\n\n---\n\n");
}

export type { Connector, ConnectorResource, ConnectorStatus } from "./types";
