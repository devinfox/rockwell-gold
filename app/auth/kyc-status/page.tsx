import type { Metadata } from "next";
import { KycStatusClient } from "../auth-clients";

export const metadata: Metadata = {
  title: "Verification status — Rockwell Metals",
  description: "Real-time KYC clearance level, transaction limits and feature access.",
};

export default function Page() {
  return <KycStatusClient />;
}
