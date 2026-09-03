import type { Metadata } from "next";
import { Suspense } from "react";
import { KycVerifyClient } from "../auth-clients";

export const metadata: Metadata = {
  title: "Identity verification — Rockwell Metals",
  description: "Submit your account for compliance review to unlock Tier 2 limits: bank wire, card checkout and insured delivery.",
};

export default function Page() {
  return (
    <Suspense fallback={<main className="wrap rm-main"><p className="rm-sub num">Loading…</p></main>}>
      <KycVerifyClient />
    </Suspense>
  );
}
