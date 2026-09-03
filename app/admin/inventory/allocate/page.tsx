import type { Metadata } from "next";
import { AllocateClient } from "../inventory-clients";

export const metadata: Metadata = {
  title: "Serial allocation — Rockwell Ops",
  description: "Match pending orders to physical vault slots and mint cryptographic Vault Passports.",
};

export default function Page() {
  return <AllocateClient />;
}
