import type { Metadata } from "next";
import TaxClient from "./tax-client";

export const metadata: Metadata = {
  title: "Tax center — Rockwell Metals",
  description: "Annual gain/loss calculator, cost basis exports, and 1099-B / Form 8300 history.",
};

export default function Page() {
  return <TaxClient />;
}
