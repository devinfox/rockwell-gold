import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInClient } from "../auth-clients";

export const metadata: Metadata = {
  title: "Sign in — Rockwell Metals",
  description: "Sign in to your Rockwell Metals vault to track orders, manage custody and settle at live spot.",
};

export default function Page() {
  return (
    <Suspense fallback={<main className="wrap rm-main"><p className="rm-sub num">Loading…</p></main>}>
      <SignInClient />
    </Suspense>
  );
}
