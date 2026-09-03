import type { Metadata } from "next";
import VaultClient from "./vault-client";

export const metadata: Metadata = {
  title: "Your Vault — Rockwell Metals",
  description:
    "Your allocated physical-gold portfolio, live. Holdings valued against spot in real time, unrealized P/L, instant spot-linked sell-back, custody passport and activity. The hard asset, traded like a digital one.",
};

export default function Page() {
  return <VaultClient />;
}
