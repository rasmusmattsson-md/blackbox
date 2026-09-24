import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  BIGQUERY_RULES,
  describeTable,
  listDatasets,
  listProjects,
  listTables,
  runQuery,
} from "@/lib/bigquery/api";
import { googleTokenForAccessToken, type GetToken } from "@/lib/google";
import { tokenOf, type CallContext } from "@/lib/mcp-auth";
import { statusOf } from "./types";
import type { Connector, ConnectorResource } from "./types";

/**
 * BigQuery is `bigquery.readonly`, not the full scope, and that is deliberate.
 *
 * Running a query creates a job, which sounds like a write — but Google lists
 * the read-only scope as sufficient for `jobs.query`, and Looker's own
 * documented read-only configuration relies on exactly this. Queries whose
 * results are written to a named destination table are the exception and will
 * be refused; this connector never asks for one.
 */
const BIGQUERY_SCOPE = "https://www.googleapis.com/auth/bigquery.readonly";

const accountFor = (ctx: CallContext | undefined) =>
  googleTokenForAccessToken(tokenOf(ctx));

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Hand failures to the model rather than the transport — see ga4.ts. */
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

/** Resolved per call so a redeploy is not needed to change the default. */
function pickProject(requested?: string): string {
  const id = requested ?? process.env.BIGQUERY_PROJECT_ID;
  if (!id) {
    throw new Error(
      "No projectId given and BIGQUERY_PROJECT_ID is not set. Call " +
        "list_datasets without a projectId to see which projects are readable.",
    );
  }
  return id;
}

const projectArg = z
  .string()
  .optional()
  .describe(
    "Google Cloud project id, e.g. 'my-project-123'. Omit to use the server " +
      "default, or call list_datasets with no arguments to discover one.",
  );

export const bigQueryConnector: Connector = {
  id: "bigquery",
  name: "Google BigQuery",
  description: "Kör läsfrågor mot dina egna datamängder och tabeller.",
  scopes: [BIGQUERY_SCOPE],
  instructions: `
Query Google BigQuery for the connected account.

${BIGQUERY_RULES}`.trim(),

  status: (getToken: GetToken) =>
    statusOf("bigquery", () => listProjects(getToken)),

  resources: async (getToken: GetToken): Promise<ConnectorResource[]> => {
    const projects = await listProjects(getToken);

    // One entry per dataset, grouped by project — the same shape the GA4
    // connector produces, so the console needs no special case.
    const perProject = await Promise.all(
      projects.map(async (project) => {
        try {
          const datasets = await listDatasets(getToken, project.id);
          return datasets.map((d) => ({
            id: `${project.id}.${d.id}`,
            name: d.id,
            group: project.name,
          }));
        } catch {
          // A project with the BigQuery API disabled must not blank the list.
          return [];
        }
      }),
    );

    return perProject.flat();
  },

  register(server: McpServer) {
    server.registerTool(
      "list_datasets",
      {
        title: "List BigQuery datasets",
        description:
          "List the BigQuery datasets the connected Google account can read. " +
          "Omit projectId to list across every readable project. Call this " +
          "first when you do not already know where the data lives.",
        inputSchema: z.object({ projectId: projectArg }),
      },
      ({ projectId }, ctx) =>
        respond(async () => {
          const getToken = accountFor(ctx);
          if (projectId) return listDatasets(getToken, projectId);

          const projects = await listProjects(getToken);
          const all = await Promise.all(
            projects.map(async (p) => {
              try {
                return await listDatasets(getToken, p.id);
              } catch {
                return [];
              }
            }),
          );
          return all.flat();
        }),
    );

    server.registerTool(
      "list_tables",
      {
        title: "List BigQuery tables",
        description:
          "List the tables and views in one dataset, with their descriptions.",
        inputSchema: z.object({
          projectId: projectArg,
          datasetId: z.string().describe("Dataset id, without the project prefix."),
        }),
      },
      ({ projectId, datasetId }, ctx) =>
        respond(() =>
          listTables(accountFor(ctx), pickProject(projectId), datasetId),
        ),
    );

    server.registerTool(
      "describe_table",
      {
        title: "Describe a BigQuery table",
        description:
          "Read a table's column names, types and row count. Do this before " +
          "writing SQL — it scans no bytes and costs nothing, while a query " +
          "with a guessed column name costs a round trip.",
        inputSchema: z.object({
          projectId: projectArg,
          datasetId: z.string(),
          tableId: z.string(),
        }),
      },
      ({ projectId, datasetId, tableId }, ctx) =>
        respond(() =>
          describeTable(
            accountFor(ctx),
            pickProject(projectId),
            datasetId,
            tableId,
          ),
        ),
    );

    server.registerTool(
      "run_query",
      {
        title: "Run a BigQuery SQL query",
        description: `
Run a read-only standard-SQL query and return the rows.

Fully qualify tables as \`project.dataset.table\`. Select only the columns you
need — BigQuery bills by bytes scanned, and the result reports what the query
cost so you can say so.

Set dryRun to validate a query and see what it would scan without running it.

${BIGQUERY_RULES}`.trim(),
        inputSchema: z.object({
          projectId: projectArg,
          sql: z.string().describe("Standard SQL. Read-only; writes are refused."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .default(100)
            .describe("Rows returned. Does not reduce what the query scans."),
          location: z
            .string()
            .optional()
            .describe("Dataset region, if not the default. e.g. 'EU'."),
          dryRun: z
            .boolean()
            .default(false)
            .describe("Validate and price the query without running it."),
        }),
      },
      ({ projectId, ...params }, ctx) =>
        respond(() =>
          runQuery(accountFor(ctx), {
            ...params,
            projectId: pickProject(projectId),
          }),
        ),
    );
  },
};
