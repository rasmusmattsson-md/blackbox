import { LegalPage, P, Section } from "@/components/legal";

export const metadata = {
  title: "Privacy Policy — BlackBox",
  description: "How this deployment handles data.",
};

/**
 * Placeholder, on purpose.
 *
 * Whoever runs this deployment is the data controller, so only they can write
 * this page. It is left as a route rather than deleted because Google requires
 * a reachable privacy policy URL before it will verify an app for the sensitive
 * Analytics and BigQuery scopes, and because the console footer links here.
 */
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="—">
      <Section heading="Not yet written">
        <P>
          This deployment has not published a privacy policy. If you operate it,
          replace this page before giving anyone else access.
        </P>
        <P>
          Facts worth stating, because they are true of the software regardless
          of who runs it: it reads Google Analytics and BigQuery with the
          read-only scopes the user grants, and it stores no credentials of its
          own — the Google refresh token is held by Auth0&apos;s Token Vault.
          Access is revoked at{" "}
          <a
            className="underline underline-offset-2 hover:text-accent"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          .
        </P>
      </Section>
    </LegalPage>
  );
}
