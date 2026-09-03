import type { Metadata } from "next";
import { AdminOrderDetailClient } from "../orders-admin-clients";

export const metadata: Metadata = {
  title: "Order inspector — Rockwell Ops",
  description: "Deep order inspector: customer 360, payment rails, serial assigner, and atomic overrides.",
};

export default async function Page({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  return <AdminOrderDetailClient orderId={id} />;
}
