import type { Metadata } from "next";
import { OrdersClient } from "./orders-clients";

export const metadata: Metadata = {
  title: "Orders — Rockwell Metals",
  description: "Omnichannel order history with the full fulfillment stepper and PDF invoices.",
};

export default function Page() {
  return <OrdersClient />;
}
