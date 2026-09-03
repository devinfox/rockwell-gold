import type { Metadata } from "next";
import { ClaimsClient } from "../support-clients";

export const metadata: Metadata = {
  title: "Insurance claims — Rockwell Metals",
  description: "Lloyd's claims portal: report delivery damage or tamper-seal compromise with 1-click claim initiation.",
};

export default function Page() {
  return <ClaimsClient />;
}
