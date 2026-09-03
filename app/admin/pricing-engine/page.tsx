import type { Metadata } from "next";
import { PricingEngineClient } from "../desk-clients";

export const metadata: Metadata = {
  title: "Pricing engine — Rockwell Ops",
  description: "Margin and spread manager: base premiums, volume tier curves, and payment surcharges.",
};

export default function Page() {
  return <PricingEngineClient />;
}
