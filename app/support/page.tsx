import type { Metadata } from "next";
import { SupportClient } from "./support-clients";

export const metadata: Metadata = {
  title: "Support — Rockwell Metals",
  description: "24/7 concierge, knowledge base, and a ticket queue synced live with the staff desk.",
};

export default function Page() {
  return <SupportClient />;
}
