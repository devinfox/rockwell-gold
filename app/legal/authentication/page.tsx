import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = {
  title: "Authentication & Assay — Rockwell Metals",
  description: "How every piece Rockwell vaults is verified before allocation.",
};

export default function Page() {
  return (
    <LegalShell
      index="A1 / Authentication"
      title="Authentication &amp; assay"
      sub="How a piece is verified before it is allocated to your vault position."
    >
      <h2>Intake</h2>
      <p>
        Metal arriving from a mint or a customer sell-back is logged as an inventory lot with its
        source, weight, declared purity and assigned vault bay before anything else happens.
      </p>

      <h2>Assay</h2>
      <p>
        Each lot is checked by X-ray fluorescence for surface composition and by ultrasonic testing
        for internal density, which is what catches a plated or filled core. The method and result are
        recorded against the lot.
      </p>

      <h2>Serial allocation</h2>
      <p>
        When your order is allocated, specific serials are bound to your order line and a custody
        passport is minted for each one. From that point the serial is yours and the ledger says so.
      </p>

      <h2>Re-verification</h2>
      <p>
        Vaulted holdings are re-verified on a timer. The timestamp of the most recent check is shown
        on each passport, and you can look up any serial you own from your vault.
      </p>

      <h2>Pick, pack and dispatch</h2>
      <p>
        On withdrawal, each serial is scanned against the order before packing — a serial that does
        not match halts the pack. Parcels ship under a tamper-evident seal whose barcode is recorded
        on the shipment.
      </p>
    </LegalShell>
  );
}
