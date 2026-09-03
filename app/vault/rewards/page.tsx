import type { Metadata } from "next";
import { RewardsClient } from "../vault-sub-clients";

export const metadata: Metadata = {
  title: "Stacker rewards — Rockwell Metals",
  description: "Sovereign tier status, volume milestones, premium discounts and free armored delivery thresholds.",
};

export default function Page() {
  return <RewardsClient />;
}
