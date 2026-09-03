import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service — Rockwell Metals",
  description: "The terms governing use of the Rockwell Metals platform.",
};

export default function Page() {
  return (
    <LegalShell
      index="L2 / Terms"
      title="Terms of service"
      sub="The agreement between you and Rockwell Metals."
      draft
    >
      <p>
        <strong>This document is not yet written.</strong> Terms of service for a platform that takes
        custody of customer assets must be drafted by a qualified lawyer — they govern title transfer,
        insolvency treatment, dispute resolution, limitation of liability, and the regulatory basis on
        which the business operates. Publishing placeholder text here would be worse than publishing
        nothing.
      </p>
      <p>
        In the meantime, the <a href="/legal/custody-charter">custody charter</a> describes how the
        platform actually handles your metal, and the{" "}
        <a href="/legal/disclosures">disclosures</a> page describes what is and is not live.
      </p>
      <p>
        Questions about a specific transaction can go to the{" "}
        <a href="/support">support desk</a>.
      </p>
    </LegalShell>
  );
}
