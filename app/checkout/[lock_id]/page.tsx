import type { Metadata } from "next";
import CheckoutClient from "./checkout-client";

export const metadata: Metadata = {
  title: "Checkout · price-lock settlement — Rockwell Metals",
  description: "120-second price freeze, custody selection, and multi-rail settlement — Fedwire or card.",
};

export default async function Page({ params }: PageProps<"/checkout/[lock_id]">) {
  const { lock_id } = await params;
  return <CheckoutClient lockId={lock_id} />;
}
