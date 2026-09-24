import type { GetToken } from "@/lib/google";

/**
 * BigQuery, with no opinion about who is asking.
 *
 * Same shape as lib/ga4/api.ts: this layer knows BigQuery and nothing else.
 * Callers pass a function that yields a bearer token, so the same query code
 * serves the console and the MCP server without either one leaking in here.
 */

const API = "https://bigquery.googleapis.com/bigquery/v2";

/**
 * Identifiers arrive from a model or a browser, so they are attacker-shaped
 * input even though the OAuth grant already bounds what is reachable. Each is
 * checked against BigQuery's own naming rules before it reaches a URL.
 */
function assertId(kind: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new Error(`"${value}" is not a valid BigQuery ${kind}.`);
  }
  return value;
}

const assertProject = (id: string) =>
  assertId("project id", id, /^[a-z][a-z0-9-]{4,29}$/);
const assertDataset = (id: string) =>
  assertId("dataset id", id, /^\w{1,1024}$/);
const assertTable = (id: string) => assertId("table id", id, /^[\w$]{1,1024}$/);

/**
 * How much a single query may scan before BigQuery refuses it.
 *
 * This exists because the caller is a language model, and `select * from` a
 * partitioned table it has not inspected is a plausible first attempt with a
 * real invoice attached. BigQuery enforces the cap itself and fails the query
 * rather than billing for it, so the worst case is an error the model can read
 * and narrow — which is the behaviour we want from a tool that spends money.
 *
 * 5 GB is roughly three US cents at on-demand pricing. Raise it with
 * BIGQUERY_MAX_BYTES_BILLED when a legitimate query needs more; set it to `0`
 * to remove the cap entirely.
 */
function maxBytesBilled(): string | undefined {
  const configured = process.env.BIGQUERY_MAX_BYTES_BILLED?.trim();
  if (configured === "0") return undefined;
  return configured || String(5 * 1024 ** 3);
}

async function bq(
  getToken: GetToken,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const token = await getToken();

  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) {
    const message = (json as { error?: { message?: string } })?.error?.message;
    throw new Error(message ?? `BigQuery returned ${res.status}`);
  }
  return json as Record<string, unknown>;
}

export interface BigQueryProject {
  id: string;
  name: string;
}

export async function listProjects(
  getToken: GetToken,
): Promise<BigQueryProject[]> {
  const json = (await bq(getToken, "/projects?maxResults=200")) as {
    projects?: { id?: string; projectReference?: { projectId?: string }; friendlyName?: string }[];
  };

  return (json.projects ?? [])
    .map((p) => ({
      id: p.projectReference?.projectId ?? p.id ?? "",
      name: p.friendlyName ?? p.projectReference?.projectId ?? p.id ?? "",
    }))
    .filter((p) => p.id);
}

export interface BigQueryDataset {
  id: string;
  projectId: string;
  location?: string;
}

export async function listDatasets(
  getToken: GetToken,
  projectId: string,
): Promise<BigQueryDataset[]> {
  const json = (await bq(
    getToken,
    `/projects/${assertProject(projectId)}/datasets?maxResults=500`,
  )) as {
    datasets?: {
      datasetReference?: { datasetId?: string; projectId?: string };
      location?: string;
    }[];
  };

  return (json.datasets ?? [])
    .map((d) => ({
      id: d.datasetReference?.datasetId ?? "",
      projectId: d.datasetReference?.projectId ?? projectId,
      location: d.location,
    }))
    .filter((d) => d.id);
}

export interface BigQueryField {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  /** Nested RECORD/STRUCT fields, flattened one level for readability. */
  fields?: BigQueryField[];
}

export interface BigQueryTable {
  id: string;
  datasetId: string;
  projectId: string;
  type?: string;
  description?: string;
  rows?: string;
  fields?: BigQueryField[];
}

export async function listTables(
  getToken: GetToken,
  projectId: string,
  datasetId: string,
): Promise<BigQueryTable[]> {
  const json = (await bq(
    getToken,
    `/projects/${assertProject(projectId)}/datasets/${assertDataset(datasetId)}/tables?maxResults=500`,
  )) as {
    tables?: {
      tableReference?: { tableId?: string };
      type?: string;
      description?: string;
    }[];
  };

  return (json.tables ?? [])
    .map((t) => ({
      id: t.tableReference?.tableId ?? "",
      datasetId,
      projectId,
      type: t.type,
      description: t.description,
    }))
    .filter((t) => t.id);
}

/**
 * A table's schema.
 *
 * The whole point of this tool: a model that guesses column names writes SQL
 * that fails, and each failure is a round trip. Reading the schema once is
 * cheaper than two rejected queries — and unlike a query, it scans no bytes.
 */
export async function describeTable(
  getToken: GetToken,
  projectId: string,
  datasetId: string,
  tableId: string,
): Promise<BigQueryTable> {
  const json = (await bq(
    getToken,
    `/projects/${assertProject(projectId)}/datasets/${assertDataset(datasetId)}` +
      `/tables/${assertTable(tableId)}?view=BASIC`,
  )) as {
    tableReference?: { tableId?: string };
    type?: string;
    description?: string;
    numRows?: string;
    schema?: { fields?: BigQueryField[] };
  };

  return {
    id: json.tableReference?.tableId ?? tableId,
    datasetId,
    projectId,
    type: json.type,
    description: json.description,
    rows: json.numRows,
    fields: json.schema?.fields ?? [],
  };
}

export interface QueryParams {
  projectId: string;
  sql: string;
  /** Rows returned to the model. The query still scans what it scans. */
  limit?: number;
  /** Dataset region, when it is not the default. e.g. 'EU', 'us-central1'. */
  location?: string;
  /** Validate and price the query without running it. */
  dryRun?: boolean;
}

export interface QueryResult {
  rows: Record<string, string | null>[];
  totalRows?: string;
  /** What the query actually scanned, so cost is visible rather than implied. */
  bytesProcessed?: string;
  /** True when BigQuery served this from cache and billed nothing. */
  cacheHit?: boolean;
  truncated?: boolean;
}

type Cell = { v?: unknown };

/**
 * BigQuery returns positional arrays keyed by a separate schema list, the same
 * shape GA4 uses. Zip them into plain objects so the model reads rows instead
 * of decoding indices.
 *
 * Only the top level is flattened. A RECORD column arrives as JSON rather than
 * being spread into the row, because spreading it would collide with sibling
 * column names and silently lose data.
 */
function flatten(
  fields: BigQueryField[],
  rows: { f?: Cell[] }[],
): Record<string, string | null>[] {
  return rows.map((row) => {
    const out: Record<string, string | null> = {};
    (row.f ?? []).forEach((cell, i) => {
      const name = fields[i]?.name ?? `f${i}`;
      const v = cell?.v;
      out[name] =
        v === null || v === undefined
          ? null
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
    });
    return out;
  });
}

export async function runQuery(
  getToken: GetToken,
  { projectId, sql, limit = 100, location, dryRun = false }: QueryParams,
): Promise<QueryResult> {
  const cap = maxBytesBilled();

  const json = (await bq(
    getToken,
    `/projects/${assertProject(projectId)}/queries`,
    {
      query: sql,
      // Standard SQL. Legacy SQL is a different dialect and nothing the model
      // knows about BigQuery today assumes it.
      useLegacySql: false,
      maxResults: limit,
      // Long enough for a real query, short enough that a hung one does not
      // eat the client's whole timeout. Incomplete jobs are reported, not
      // waited on.
      timeoutMs: 60_000,
      ...(cap ? { maximumBytesBilled: cap } : {}),
      ...(location ? { location } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    },
  )) as {
    schema?: { fields?: BigQueryField[] };
    rows?: { f?: Cell[] }[];
    totalRows?: string;
    totalBytesProcessed?: string;
    cacheHit?: boolean;
    jobComplete?: boolean;
  };

  if (json.jobComplete === false) {
    throw new Error(
      "The query is still running after 60 seconds. Narrow the date range or " +
        "add a LIMIT, then try again.",
    );
  }

  const fields = json.schema?.fields ?? [];
  const rows = flatten(fields, json.rows ?? []);

  return {
    rows,
    totalRows: json.totalRows,
    bytesProcessed: json.totalBytesProcessed,
    cacheHit: json.cacheHit,
    truncated:
      json.totalRows !== undefined && Number(json.totalRows) > rows.length,
  };
}

/** How to use these tools well, folded into the MCP server's instructions. */
export const BIGQUERY_RULES = `
- Call list_datasets and describe_table before writing SQL. Guessed column
  names cost a round trip each; a schema read costs nothing and scans no bytes.
- Always qualify tables fully: \`project.dataset.table\`.
- Select only the columns you need. BigQuery bills by bytes scanned, and
  \`select *\` on a wide table is the expensive way to ask any question.
- Filter on the partition column when a table has one.
- This connection is read-only. Anything that writes will be refused.`.trim();
