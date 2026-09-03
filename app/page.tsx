import type { Metadata } from "next";
import HomeClient from "./home-client";

export const metadata: Metadata = {
  title: "Rockwell Metals — The hard asset, traded like a digital one",
  description:
    "A live marketplace for buying physical gold — coins, bars, and rare collectibles. Live prices, limited drops, verified authenticity. The hard asset, traded like a digital one.",
};

export default function Page() {
  return <HomeClient />;
}
