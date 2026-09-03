import type { Metadata } from "next";
import { SellBackTerminalClient } from "../vault-sub-clients";

export const metadata: Metadata = {
  title: "Sell-back terminal — Rockwell Metals",
  description: "Instant liquidity: freeze a 90-second live bid at a 0.5% spread and disburse to USDC or wire in minutes.",
};

export default function Page() {
  return <SellBackTerminalClient />;
}
