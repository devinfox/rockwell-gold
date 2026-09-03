import type { Metadata } from "next";
import { AdminSupportClient } from "../desk-clients";

export const metadata: Metadata = {
  title: "Support desk — Rockwell Ops",
  description: "Unified staff ticket queue with live chat takeover and dispute resolution.",
};

export default function Page() {
  return <AdminSupportClient />;
}
