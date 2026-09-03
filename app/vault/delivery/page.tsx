import type { Metadata } from "next";
import { WithdrawalClient } from "../vault-sub-clients";

export const metadata: Metadata = {
  title: "Armored withdrawal — Rockwell Metals",
  description: "Pull vaulted serials into insured armored transit — Brinks, FedEx Priority, or Malca-Amit.",
};

export default function Page() {
  return <WithdrawalClient />;
}
