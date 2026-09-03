import type { Metadata } from "next";
import { AdminOtcClient } from "../../desk-clients";

export const metadata: Metadata = {
  title: "OTC quotes — Rockwell Ops",
  description: "Lock large spot-linked allocations for institutional buyers with custom wire instructions.",
};

export default function Page() {
  return <AdminOtcClient />;
}
