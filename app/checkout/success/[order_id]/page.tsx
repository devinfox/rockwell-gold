import type { Metadata } from "next";
import SuccessClient from "./success-client";

export const metadata: Metadata = {
  title: "Order settled · Vault Passport — Rockwell Metals",
  description: "Cryptographic receipt, Vault Passport minting, and Lloyd's policy linkage.",
};

export default async function Page({ params, searchParams }: PageProps<"/checkout/success/[order_id]">) {
  const { order_id } = await params;
  // Stripe appends ?session_id=cs_… on return from hosted Checkout. Read here
  // on the server so the client needs no useSearchParams/Suspense boundary.
  const sp = await searchParams;
  const raw = sp?.session_id;
  const sessionId = typeof raw === "string" && /^cs_[A-Za-z0-9_]{8,}$/.test(raw) ? raw : undefined;
  return <SuccessClient orderId={order_id} sessionId={sessionId} />;
}
