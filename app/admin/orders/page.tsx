import type { Metadata } from "next";
import { AdminOrdersClient } from "./orders-admin-clients";

export const metadata: Metadata = {
  title: "Orders · OMS — Rockwell Ops",
  description: "Omnichannel order management: high-density grid with multi-status filters and batch transitions.",
};

export default function Page() {
  return <AdminOrdersClient />;
}
