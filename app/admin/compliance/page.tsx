import type { Metadata } from "next";
import { ComplianceClient } from "../desk-clients";

export const metadata: Metadata = {
  title: "Compliance — Rockwell Ops",
  description: "KYC review queue, FinCEN Form 8300 monitor, OFAC screening, SAR management.",
};

export default function Page() {
  return <ComplianceClient />;
}
