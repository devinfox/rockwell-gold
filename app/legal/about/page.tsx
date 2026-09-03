import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = {
  title: "About — Rockwell Metals",
  description: "What Rockwell Metals is and how the platform works.",
};

export default function Page() {
  return (
    <LegalShell
      index="A0 / About"
      title="About Rockwell"
      sub="A marketplace for physical precious metals with custody, settlement and liquidity in one place."
    >
      <h2>What it does</h2>
      <p>
        Rockwell lists physical coins and bars, freezes a price while you settle, verifies and
        allocates specific serial-numbered pieces to you, and then either vaults them under your name
        or ships them to you by insured armoured carrier.
      </p>

      <h2>Custody</h2>
      <p>
        Vaulted metal is allocated and segregated — see the{" "}
        <a href="/legal/custody-charter">custody charter</a>. Every piece carries a passport recording
        its assay, purity, weight and vault position.
      </p>

      <h2>Liquidity</h2>
      <p>
        Vaulted holdings can be sold back at a quoted bid without leaving the platform, or withdrawn
        physically at any time.
      </p>

      <h2>Record keeping</h2>
      <p>
        Every state change — payment, assay, allocation, pack scan, dispatch, delivery — is timestamped
        on an append-only ledger, and your tax centre builds a gain/loss statement from those same
        records.
      </p>
    </LegalShell>
  );
}
