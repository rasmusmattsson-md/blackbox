"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CloseIcon, CopyIcon, GoogleIcon } from "@/components/icons";
import type { ConnectorInfo } from "@/lib/connectors/catalog";

/** Everything the server knows before the browser asks for anything. */
export interface ConsoleProps {
  signedIn: boolean;
  email?: string;
  /** The URL to paste into an MCP client. */
  mcpUrl?: string;
  /** Names of environment variables this deployment still needs. */
  missing: string[];
  authError?: string;
  /** The catalog as the server already resolved it, for the first paint. */
  connectors: ConnectorInfo[];
}

export function Console(props: ConsoleProps) {
  const { signedIn, email, mcpUrl, missing } = props;

  // Rendered straight from the server render. Nothing in this page mutates the
  // catalog any more — connecting is a redirect and revoking happens at Google
  // — so there is no client-side refetch to keep in sync with it.
  const connectors = props.connectors;
  const [authError, setAuthError] = useState(props.authError);

  // Drop `?error=` once it has been read, so a refresh doesn't replay it. Pure
  // external update — the message itself came in as a prop.
  useEffect(() => {
    if (props.authError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [props.authError]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-5 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">BlackBox</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Koppla dina datakällor och läs dem från Claude.
          </p>
        </div>

        {signedIn && (
          /* A navigation, not a fetch: Auth0 ends the session by redirecting. */
          <a
            href="/auth/logout"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm transition-colors hover:bg-sunken"
          >
            Logga ut
          </a>
        )}
      </header>

      {authError && (
        <Banner tone="danger" onDismiss={() => setAuthError(undefined)}>
          {authError}
        </Banner>
      )}

      {missing.length > 0 && (
        <Banner tone="danger">
          Servern saknar konfiguration och kan inte svara på MCP-anrop:{" "}
          <span className="font-mono text-xs">{missing.join(", ")}</span>. Se{" "}
          <span className="font-mono text-xs">.env.example</span>.
        </Banner>
      )}

      {!signedIn ? (
        <SignIn />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-ink-muted">Anslutningar</h2>

            {connectors.map((connector) => (
              <ConnectorCard key={connector.id} connector={connector} />
            ))}
          </section>

          {mcpUrl && <McpDetails url={mcpUrl} />}
        </>
      )}

      <footer className="mt-auto pt-6 text-xs text-ink-faint">
        {email && <span>Inloggad som {email} · </span>}
        <a className="hover:text-ink-muted" href="/privacy">
          Integritetspolicy
        </a>{" "}
        ·{" "}
        <a className="hover:text-ink-muted" href="/terms">
          Villkor
        </a>
      </footer>
    </div>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "danger" | "muted";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : undefined}
      className={`flex items-start gap-3 rounded-xl px-3.5 py-2.5 text-sm ${
        tone === "danger"
          ? "bg-danger-soft text-danger"
          : "bg-sunken text-ink-muted"
      }`}
    >
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Stäng"
          className="shrink-0 rounded p-0.5 hover:bg-danger/10"
        >
          <CloseIcon className="size-4" />
        </button>
      )}
    </p>
  );
}

function SignIn() {
  return (
    <section className="rounded-2xl border border-line bg-surface p-8 text-center">
      <p className="text-sm text-ink-muted">
        Logga in med det Google-konto vars analysdata du vill läsa. Samma
        inloggning ger både identiteten och behörigheten — det är ett steg, inte
        två.
      </p>

      {/* A full navigation, not fetch: this begins an OAuth redirect. */}
      <a
        href="/auth/login"
        className="mt-5 inline-flex items-center gap-2.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-surface transition-opacity hover:opacity-90"
      >
        <GoogleIcon />
        Logga in med Google
      </a>
    </section>
  );
}

/**
 * One data source, and whether it can be read.
 *
 * There is no disconnect button, and that is deliberate rather than missing.
 * The Google credential lives in Auth0's token vault, not here — this server
 * has nothing to delete, so a button would report a disconnection that never
 * happened while Claude kept reading. Revoking is done where the grant
 * actually is, and the card says where.
 */
function ConnectorCard({ connector }: { connector: ConnectorInfo }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">
          <GoogleIcon />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{connector.name}</h3>
            {connector.connected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                <CheckIcon className="size-3" />
                Ansluten
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">{connector.description}</p>

          {connector.connected && (
            <p className="mt-2 text-xs text-ink-faint">
              {connector.resources.length}{" "}
              {connector.resources.length === 1 ? "egenskap" : "egenskaper"}{" "}
              tillgängliga · återkalla på{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                myaccount.google.com/permissions
              </a>
            </p>
          )}

          {connector.error && (
            <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
              {connector.error}
            </p>
          )}
        </div>

        {!connector.connected && (
          <a
            href={connector.connectPath}
            className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-surface transition-opacity hover:opacity-90"
          >
            Anslut
          </a>
        )}
      </div>
    </div>
  );
}

function McpDetails({ url }: { url: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-ink-muted">MCP-adress</h2>

      <div className="rounded-xl border border-line bg-surface p-4">
        <Copyable value={url} />

        <p className="mt-3 text-xs text-ink-muted">
          Lägg till adressen som en egen connector i Claude. Claude hittar
          inloggningen själv, registrerar sig hos Auth0 och frågar efter ditt
          konto.
        </p>
      </div>
    </section>
  );
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 font-mono text-xs">
        {value}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Kopiera adressen"
        className="shrink-0 rounded-lg border border-line-strong p-2 transition-colors hover:bg-sunken"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}
