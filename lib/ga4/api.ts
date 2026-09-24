import type { GetToken } from "@/lib/google";

/**
 * Google Analytics 4, with no opinion about who is asking.
 *
 * This layer knows GA4 and nothing else — no session, no cookies, no Auth0.
 * Callers pass a function that yields a bearer token, which is what lets the
 * same report code serve both front doors: the console, where the token comes
 * from the signed-in user's session, and the MCP endpoint, where it is derived
 * from the token the caller presented.
 *
 * The parts worth having exactly one copy of are here: the orderBy
 * metric-vs-dimension branch, the dimensionFilter nesting, and `flatten`.
 */

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

/** The dimensions and metrics that answer most questions, so the model never
 *  has to spend a turn looking them up. */
export const COMMON_FIELDS = `
Common dimensions: date, dateHour, country, city, deviceCategory, browser,
  sessionSource, sessionMedium, sessionSourceMedium, sessionCampaignName,
  sessionDefaultChannelGroup, pagePath, pageTitle, landingPage, eventName,
  newVsReturning, language.
Common metrics: activeUsers, newUsers, totalUsers, sessions, engagedSessions,
  engagementRate, bounceRate, averageSessionDuration, screenPageViews,
  screenPageViewsPerSession, eventCount, keyEvents, userKeyEventRate,
  totalRevenue, purchaseRevenue, transactions.`.trim();

/**
 * How to use the tools well.
 *
 * Over MCP there is no system prompt to inject — the client owns it — so this
 * text is folded into the tool descriptions and into the server's advertised
 * instructions. Both need it, so it lives here rather than in either one.
 *
 * The two paths name the same tool differently (`ga4_find_fields` in the app,
 * `find_fields` over MCP), so the caller passes the name it registered.
 */
export function ga4Rules(findFieldsTool: string): string {
  return `
- Never invent numbers. Every figure stated must come from a tool result.
- Prefer one report with several metrics over several reports.
- When a question implies a comparison ("vs last month"), run one report per
  period and compare the results.
- If a dimension or metric name is rejected, use ${findFieldsTool} to find the
  right one rather than guessing twice.`.trim();
}

export const MATCH_TYPES = [
  "EXACT",
  "BEGINS_WITH",
  "ENDS_WITH",
  "CONTAINS",
  "FULL_REGEXP",
] as const;

export type MatchType = (typeof MATCH_TYPES)[number];

/**
 * Property ids arrive from a model or a browser, so they are attacker-shaped
 * input even though the OAuth grant already bounds which properties are
 * reachable. GA4 property ids are always numeric; anything else never reaches
 * a URL.
 */
export function assertPropertyId(id: string): string {
  if (!/^\d+$/.test(id)) {
    throw new Error(`"${id}" is not a valid GA4 property id.`);
  }
  return id;
}

async function ga4Fetch(
  getToken: GetToken,
  propertyId: string,
  path: string,
  body?: unknown,
) {
  const token = await getToken();

  const res = await fetch(
    `${DATA_API}/properties/${assertPropertyId(propertyId)}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      json?.error?.message ?? `Google Analytics returned ${res.status}`,
    );
  }
  return json;
}

type Header = { name: string };
type Row = {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
};

/** GA4 returns positional arrays keyed by separate header lists. Zip them into
 *  plain objects so the model reads rows instead of decoding indices. */
function flatten(json: {
  dimensionHeaders?: Header[];
  metricHeaders?: Header[];
  rows?: Row[];
}) {
  const names = [
    ...(json.dimensionHeaders ?? []).map((h) => h.name),
    ...(json.metricHeaders ?? []).map((h) => h.name),
  ];
  return (json.rows ?? []).map((row) => {
    const values = [
      ...(row.dimensionValues ?? []),
      ...(row.metricValues ?? []),
    ];
    return Object.fromEntries(
      names.map((n, i) => [n, values[i]?.value ?? null]),
    );
  });
}

export interface ReportParams {
  propertyId: string;
  metrics: string[];
  dimensions?: string[];
  startDate: string;
  endDate: string;
  limit?: number;
  orderBy?: { field: string; descending?: boolean };
  filter?: { dimension: string; matchType: MatchType; value: string };
}

export interface ReportResult {
  rows: Record<string, string | null>[];
  rowCount: number;
  truncated: boolean;
}

export async function runReport(
  getToken: GetToken,
  {
    propertyId,
    metrics,
    dimensions = [],
    startDate,
    endDate,
    limit = 50,
    orderBy,
    filter,
  }: ReportParams,
): Promise<ReportResult> {
  const json = await ga4Fetch(getToken, propertyId, ":runReport", {
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    dateRanges: [{ startDate, endDate }],
    limit: String(limit),
    ...(orderBy && {
      orderBys: [
        // GA4 takes a different shape depending on which list the field is in,
        // and rejects the wrong one.
        metrics.includes(orderBy.field)
          ? {
              metric: { metricName: orderBy.field },
              desc: orderBy.descending ?? true,
            }
          : {
              dimension: { dimensionName: orderBy.field },
              desc: orderBy.descending ?? true,
            },
      ],
    }),
    ...(filter && {
      dimensionFilter: {
        filter: {
          fieldName: filter.dimension,
          stringFilter: {
            matchType: filter.matchType,
            value: filter.value,
          },
        },
      },
    }),
  });

  return {
    rows: flatten(json),
    rowCount: json.rowCount ?? 0,
    truncated: (json.rowCount ?? 0) > limit,
  };
}

export interface FindFieldsParams {
  propertyId: string;
  search?: string;
  includeStandard?: boolean;
}

export interface Field {
  apiName: string;
  uiName: string;
  custom: boolean;
}

export async function findFields(
  getToken: GetToken,
  { propertyId, search, includeStandard = false }: FindFieldsParams,
): Promise<{ dimensions: Field[]; metrics: Field[] }> {
  const json = await ga4Fetch(getToken, propertyId, "/metadata");
  const term = search?.toLowerCase();

  const pickFields = (items: Record<string, string | boolean>[] = []) =>
    items
      .filter((f) => includeStandard || f.customDefinition === true)
      .filter(
        (f) =>
          !term ||
          `${f.apiName} ${f.uiName} ${f.description ?? ""}`
            .toLowerCase()
            .includes(term),
      )
      .slice(0, 60)
      .map((f) => ({
        apiName: String(f.apiName),
        uiName: String(f.uiName),
        custom: f.customDefinition === true,
      }));

  return {
    dimensions: pickFields(json.dimensions),
    metrics: pickFields(json.metrics),
  };
}

interface PropertySummary {
  property: string; // "properties/123456789"
  displayName: string;
}

export interface Property {
  id: string;
  name: string;
  /** The GA4 account the property belongs to. */
  group?: string;
}

/**
 * Every GA4 property the token's account can see.
 *
 * Doubles as the connection test: this is the first call that actually uses
 * the grant, so a bad credential surfaces here rather than midway through the
 * first report.
 */
export async function listProperties(
  getToken: GetToken,
): Promise<Property[]> {
  const token = await getToken();
  const res = await fetch(`${ADMIN_API}/accountSummaries?pageSize=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Google returned ${res.status}`);
  }

  return (json.accountSummaries ?? []).flatMap(
    (account: {
      displayName: string;
      propertySummaries?: PropertySummary[];
    }) =>
      (account.propertySummaries ?? []).map((p) => ({
        id: p.property.replace("properties/", ""),
        name: p.displayName,
        group: account.displayName,
      })),
  );
}
