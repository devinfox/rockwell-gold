import type { Metadata } from "next";
import { TrackingClient } from "../../orders-clients";

export const metadata: Metadata = {
  title: "Armored tracking — Rockwell Metals",
  description: "Live carrier checkpoints, tamper-evident seal verification, and signature confirmation.",
};

export default async function Page({ params }: PageProps<"/orders/tracking/[shipment_id]">) {
  const { shipment_id } = await params;
  return <TrackingClient shipmentId={shipment_id} />;
}
