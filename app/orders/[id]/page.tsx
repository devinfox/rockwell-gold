import type { Metadata } from "next";
import { OrderDetailClient } from "../orders-clients";

export const metadata: Metadata = {
  title: "Order — Rockwell Metals",
  description: "Interactive fulfillment stepper, receipt, vault passports and status history.",
};

export default async function Page({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  return <OrderDetailClient orderId={id} />;
}
