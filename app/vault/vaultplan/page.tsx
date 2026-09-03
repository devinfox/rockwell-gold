import type { Metadata } from "next";
import { VaultPlanClient } from "../vault-sub-clients";

export const metadata: Metadata = {
  title: "VaultPlan — Rockwell Metals",
  description: "Dollar-cost averaging engine: weekly auto-buys into allocated, insured custody.",
};

export default function Page() {
  return <VaultPlanClient />;
}
