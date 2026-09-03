import type { Metadata } from "next";
import AdminHomeClient from "./admin-home-client";

export const metadata: Metadata = {
  title: "Command center — Rockwell Ops",
  description: "Executive operations command center: 24h GMV, net ounces, wire queue, fulfillment velocity, transit map.",
};

export default function Page() {
  return <AdminHomeClient />;
}
