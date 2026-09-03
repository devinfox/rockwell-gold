import type { Metadata } from "next";
import DropsClient from "./drops-client";

export const metadata: Metadata = {
  title: "Drops & Auctions — Rockwell Metals",
  description: "Limited verified inventory released in timed market drops. Live English and Dutch auction rooms with 30-second anti-snipe extensions.",
};

export default function Page() {
  return <DropsClient />;
}
