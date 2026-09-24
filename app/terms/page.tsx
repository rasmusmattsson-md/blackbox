import { LegalPage, P, Section } from "@/components/legal";

export const metadata = {
  title: "Terms of Service — BlackBox",
  description: "The terms this deployment is offered under.",
};

/**
 * Placeholder, on purpose — see the note in ../privacy/page.tsx.
 */
export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="—">
      <Section heading="Not yet written">
        <P>
          This deployment has not published terms of service. If you operate it,
          replace this page before giving anyone else access.
        </P>
      </Section>
    </LegalPage>
  );
}
