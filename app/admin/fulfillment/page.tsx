import type { Metadata } from "next";
import { FulfillmentClient } from "../orders/orders-admin-clients";

export const metadata: Metadata = {
  title: "Fulfillment — Rockwell Ops",
  description: "Pick/pack/ship terminal: barcode scan verification, TEB seals, thermal labels, armored dispatch.",
};

export default function Page() {
  return <FulfillmentClient />;
}
