import { Console } from "@/components/console";
import { auth0, missingAuth0Config } from "@/lib/auth0";
import { appUrl, resourceUrl } from "@/lib/config";
import { catalogFor } from "@/lib/connectors/catalog";
import { googleTokenForSession } from "@/lib/google";

/** What an `?error=` code on the way back from Auth0 means, in words. */
function authErrorMessage(code: string): string {
  const known: Record<string, string> = {
    access_denied: "Du nekade behörigheten. Försök igen och godkänn åtkomsten till Analytics.",
    login_required: "Sessionen har gått ut. Logga in igen.",
    consent_required: "Google bad om samtycke igen. Logga in och godkänn.",
  };
  return known[code] ?? code;
}

/**
 * The console, rendered from what the server already knows.
 *
 * Configuration and session are both environment facts by the time this runs,
 * so they are resolved here rather than fetched: the first paint should already
 * say whether this deployment can work, not discover it a round trip later.
 */
export default async function Page({ searchParams }: PageProps<"/">) {
  const error = (await searchParams).error;
  const code = Array.isArray(error) ? error[0] : error;

  const session = await auth0.getSession();

  // resourceUrl() throws when neither APP_URL nor MCP_RESOURCE_URL is set, and
  // an unconfigured deployment is exactly when someone opens this page.
  const mcpUrl = appUrl() ? resourceUrl() : undefined;

  const missing = [...missingAuth0Config(), !mcpUrl && "APP_URL"].filter(
    (name): name is string => Boolean(name),
  );

  return (
    <Console
      connectors={await catalogFor(session ? googleTokenForSession() : undefined)}
      signedIn={Boolean(session)}
      email={session?.user?.email as string | undefined}
      mcpUrl={mcpUrl}
      missing={missing}
      authError={code ? authErrorMessage(code) : undefined}
    />
  );
}
