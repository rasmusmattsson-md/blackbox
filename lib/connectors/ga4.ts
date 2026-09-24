import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ANALYTICS_SCOPE } from "@/lib/auth0";
import {
  COMMON_FIELDS,
  findFields,
  ga4Rules,
  listProperties,
  MATCH_TYPES,
  runReport,
} from "@/lib/ga4/api";
import { googleTokenForAccessToken, type GetToken } from "@/lib/google";
import { tokenOf, type CallContext } from "@/lib/mcp-auth";
import { statusOf } from "./types";
import type { Connector, ConnectorResource } from "./types";

/**
 * The Google account this particular call may read.
 *
 * Resolved per call, from the token the caller presented — not from anything
 * stored. Two people using the same server get two different Google accounts
 * because they arrive with two different tokens, and nothing in between has to
 * remember which is which.
 */
const accountFor = (ctx: CallContext | undefined) =>
  googleTokenForAccessToken(tokenOf(ctx));

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Hand failures to the model instead of to the transport.
 *
 * A thrown error ends the tool call; an `isError` result comes back as
 * something the model can read, so it can fix a rejected dimension name and
 * retry rather than the turn ending on an error it never saw.
 */
async function respond(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (e) {
    return {
      content: [
        { type: "text", text: e instanceof Error ? e.message : String(e) },
      ],
      isError: true,
    };
  }
}

/**
 * Over MCP the client owns the system prompt, so everything the model needs to
 * know has to travel in the tool schema itself. That is why `run_report`'s
 * description carries the whole field list: without it the model invents GA4
 * API names that do not exist.
 */
const RUN_REPORT_DESCRIPTION = `
Run a Google Analytics 4 report. Returns one row per combination of the
requested dimensions.

Dates accept YYYY-MM-DD, or the relative forms 'today', 'yesterday' and
'NdaysAgo' (e.g. '28daysAgo').

${COMMON_FIELDS}

${ga4Rules("find_fields")}`.trim();

/** Resolved per call so a redeploy is not needed to change the default. */
function pickProperty(requested?: string): string {
  const id = requested ?? process.env.GA4_PROPERTY_ID;
  if (!id) {
    throw new Error(
      "No propertyId given and GA4_PROPERTY_ID is not set. Call " +
        "list_properties first, then pass one of the ids it returns.",
    );
  }
  return id;
}

const propertyArg = z
  .string()
  .optional()
  .describe(
    "GA4 property id, e.g. '123456789' — numeric, with no 'properties/' " +
      "prefix. Get one from list_properties. Omit to use the server default.",
  );

/** The guidance a client may show the model, when it chooses to. */
export const GA4_INSTRUCTIONS = `
Read Google Analytics 4 data for the connected account.

Start with list_properties unless you already have a property id. Answer with
figures from run_report only — never estimate or recall analytics numbers.

${COMMON_FIELDS}`.trim();

export const ga4Connector: Connector = {
  id: "ga4",
  name: "Google Analytics",
  description: "Läs rapporter om trafik, förvärv, engagemang och intäkter.",
  scopes: [ANALYTICS_SCOPE],
  instructions: GA4_INSTRUCTIONS,

  status: (getToken: GetToken) =>
    statusOf("ga4", () => listProperties(getToken)),

  resources: (getToken: GetToken): Promise<ConnectorResource[]> =>
    listProperties(getToken),

  register(server: McpServer) {
    server.registerTool(
      "list_properties",
      {
        title: "List Google Analytics properties",
        description:
          "List every GA4 property the connected Google account can read, " +
          "with its id, name and owning account. Call this first when you do " +
          "not already know which property id to report on.",
        inputSchema: z.object({}),
      },
      (_args, ctx) => respond(() => listProperties(accountFor(ctx))),
    );

    server.registerTool(
      "run_report",
      {
        title: "Run a Google Analytics report",
        description: RUN_REPORT_DESCRIPTION,
        inputSchema: z.object({
          propertyId: propertyArg,
          metrics: z
            .array(z.string())
            .min(1)
            .max(10)
            .describe("GA4 metric API names, e.g. ['sessions', 'activeUsers']"),
          dimensions: z
            .array(z.string())
            .max(9)
            .default([])
            .describe("GA4 dimension API names. Omit for a single total row."),
          startDate: z.string().describe("Inclusive start of the date range."),
          endDate: z.string().describe("Inclusive end of the date range."),
          limit: z.number().int().min(1).max(1000).default(50),
          orderBy: z
            .object({
              field: z
                .string()
                .describe("A metric or dimension name from this same call."),
              descending: z.boolean().default(true),
            })
            .optional(),
          filter: z
            .object({
              dimension: z.string(),
              matchType: z.enum(MATCH_TYPES),
              value: z.string(),
            })
            .optional()
            .describe("A single dimension filter."),
        }),
      },
      ({ propertyId, ...params }, ctx) =>
        respond(() =>
          runReport(accountFor(ctx), {
            ...params,
            propertyId: pickProperty(propertyId),
          }),
        ),
    );

    server.registerTool(
      "find_fields",
      {
        title: "Find Google Analytics fields",
        description:
          "Look up the custom dimensions and metrics defined on a GA4 " +
          "property, or search for an API name you are unsure about. The " +
          "standard fields are already listed in run_report's description — " +
          "use this when a name was rejected, or to find custom fields.",
        inputSchema: z.object({
          propertyId: propertyArg,
          search: z
            .string()
            .optional()
            .describe(
              "Case-insensitive substring matched against names and " +
                "descriptions. Omit to list all custom fields.",
            ),
          includeStandard: z
            .boolean()
            .default(false)
            .describe(
              "Set true to search standard fields as well as custom ones.",
            ),
        }),
      },
      ({ propertyId, ...params }, ctx) =>
        respond(() =>
          findFields(accountFor(ctx), {
            ...params,
            propertyId: pickProperty(propertyId),
          }),
        ),
    );
  },
};

