import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = {
  title: "Custody Charter — Rockwell Metals",
  description: "How Rockwell holds your metal: allocated, segregated, never lent, never rehypothecated.",
};

export default function Page() {
  return (
    <LegalShell
      index="L1 / Custody"
      title="Custody charter"
      sub="What we promise about how your metal is held. This is the document you accept when you open an account."
      draft
    >
      <h2>Allocated</h2>
      <p>
        Every piece you buy is recorded against a specific serial number and assigned to a specific
        vault position. You own identified metal, not a claim against a pool.
      </p>

      <h2>Segregated</h2>
      <p>
        Your metal is stored apart from Rockwell&apos;s own inventory and apart from other customers&apos;
        holdings. It does not appear on Rockwell&apos;s balance sheet, and it is not available to
        Rockwell&apos;s creditors.
      </p>

      <h2>Never lent, never rehypothecated</h2>
      <p>
        Rockwell does not lease, lend, pledge, or otherwise encumber customer metal. There is no
        fractional reserve arrangement and no leasing programme.
      </p>

      <h2>Your right to take delivery</h2>
      <p>
        You may request physical delivery of any vaulted holding at any time through your vault.
        Delivery is by insured armoured carrier and requires identity verification at handover.
      </p>

      <h2>Verification</h2>
      <p>
        Each holding carries a custody passport recording its assay method, purity, weight, vault
        position, and the timestamp of its most recent verification. You can view this record for any
        serial you own.
      </p>

      <h2>What this charter does not cover</h2>
      <p>
        Insurance limits, claim procedures, storage fees after the first year, and the treatment of
        holdings in the event of Rockwell&apos;s insolvency are governed by the terms of service and
        the relevant insurance policy. Those documents are still being prepared — see the notice above.
      </p>
    </LegalShell>
  );
}
