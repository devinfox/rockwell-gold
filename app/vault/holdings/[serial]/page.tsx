import type { Metadata } from "next";
import { HoldingPassportClient } from "../../vault-sub-clients";

export const metadata: Metadata = {
  title: "Custody passport — Rockwell Metals",
  description: "Deep custody passport: XRF assay breakdown, ultrasonic test, vault bay location, Lloyd's certificate.",
};

export default async function Page({ params }: PageProps<"/vault/holdings/[serial]">) {
  const { serial } = await params;
  return <HoldingPassportClient serial={decodeURIComponent(serial)} />;
}
