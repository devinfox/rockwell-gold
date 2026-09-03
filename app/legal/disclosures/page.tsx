import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = {
  title: "Disclosures — Rockwell Metals",
  description: "Risk, pricing and platform-status disclosures for Rockwell Metals.",
};

export default function Page() {
  return (
    <LegalShell
      index="L4 / Disclosures"
      title="Disclosures"
      sub="Plain statements about risk, pricing, and what is live on this platform."
    >
      <h2>Precious metals carry risk</h2>
      <p>
        The value of physical metal moves with the market and can fall as well as rise. Past
        performance says nothing about future returns. Nothing on this site is investment advice, and
        Rockwell does not make suitability assessments.
      </p>

      <h2>Pricing</h2>
      <p>
        Catalogue prices are snapshot values taken from the source feed and are <strong>not</strong>{" "}
        currently linked to a live spot market. No live market data provider is connected on this
        environment; spot figures shown anywhere on the site are indicative reference marks, clearly
        labelled as such. Do not rely on them for a trading decision.
      </p>

      <h2>Buy/sell spread</h2>
      <p>
        Sell-back bids are quoted below the metal value by the spread published on your vault page.
        Payment rail surcharges are shown at checkout before you commit.
      </p>

      <h2>Tax</h2>
      <p>
        The tax centre produces a record of your own transactions. It is not a filed tax form,
        Rockwell does not file on your behalf, and it is not tax advice. Take it to an accountant.
      </p>

      <h2>Platform status</h2>
      <p>
        Identity verification is reviewed by a person rather than an automated provider. Product
        imagery is currently served from third-party sources pending migration to Rockwell-hosted
        storage.
      </p>
    </LegalShell>
  );
}
