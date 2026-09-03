import type { Metadata } from "next";
import SuccessClient from "./success-client";

export const metadata: Metadata = {
  title: "Order settled · Vault Passport — Rockwell Metals",
  description: "Cryptographic receipt, Vault Passport minting, and Lloyd's policy linkage.",
};

export default async function Page({ params }: PageProps<"/checkout/success/[order_id]">) {
  const { order_id } = await params;
  return <SuccessClient orderId={order_id} />;
}
