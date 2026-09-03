import type { Metadata } from "next";
import { AdminSellbacksClient } from "../desk-clients";

export const metadata: Metadata = {
  title: "Sell-back desk — Rockwell Ops",
  description: "Inbound liquidation queue: locked bid review, KYC clearance, 1-click payout processing.",
};

export default function Page() {
  return <AdminSellbacksClient />;
}
