import type { Metadata } from "next";
import { AuditLogsClient } from "../desk-clients";

export const metadata: Metadata = {
  title: "Audit ledger — Rockwell Ops",
  description: "Immutable append-only activity log: who, what, when, IP, and before/after diffs.",
};

export default function Page() {
  return <AuditLogsClient />;
}
