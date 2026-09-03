import type { Metadata } from "next";
import { AdminCustomersClient } from "../desk-clients";

export const metadata: Metadata = {
  title: "Customer 360 — Rockwell Ops",
  description: "Searchable client directory with KYC tiers, lifetime GMV, vault balances and risk ratings.",
};

export default function Page() {
  return <AdminCustomersClient />;
}
