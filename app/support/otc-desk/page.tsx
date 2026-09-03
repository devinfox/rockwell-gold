import type { Metadata } from "next";
import { OtcDeskClient } from "../support-clients";

export const metadata: Metadata = {
  title: "OTC desk — Rockwell Metals",
  description: "Institutional desk: custom allocations above $100k, bullion swaps, and block pricing quoted by a senior trader.",
};

export default function Page() {
  return <OtcDeskClient />;
}
