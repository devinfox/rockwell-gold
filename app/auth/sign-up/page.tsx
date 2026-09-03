import type { Metadata } from "next";
import { Suspense } from "react";
import { SignUpClient } from "../auth-clients";

export const metadata: Metadata = {
  title: "Open account — Rockwell Metals",
  description: "Individual stacker account. Progressive KYC: start under $10k instantly, verify up as your allocation grows.",
};

export default function Page() {
  return (
    <Suspense fallback={<main className="wrap rm-main"><p className="rm-sub num">Loading…</p></main>}>
      <SignUpClient />
    </Suspense>
  );
}
