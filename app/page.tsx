import type { Metadata } from "next";
import HomeClient from "./home-client";

export const metadata: Metadata = {
  title: "Rockwell Metals — Physical gold, traded like a digital asset",
  description:
    "Buy physical gold, silver and platinum at live spot-linked prices. 120-second price lock, allocated and insured vault custody, serial-level custody passports, and instant sell-back liquidity. Settle in USDC, wire or card.",
  alternates: { canonical: "/" },
};

export default function Page() {
  return <HomeClient />;
}
