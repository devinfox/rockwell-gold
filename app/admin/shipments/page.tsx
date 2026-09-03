import type { Metadata } from "next";
import { AdminShipmentsClient } from "../orders/orders-admin-clients";

export const metadata: Metadata = {
  title: "Transit control — Rockwell Ops",
  description: "Real-time carrier telemetry, delivery exceptions, and chain-of-custody tracking.",
};

export default function Page() {
  return <AdminShipmentsClient />;
}
