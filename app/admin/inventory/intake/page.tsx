import type { Metadata } from "next";
import { IntakeClient } from "../inventory-clients";

export const metadata: Metadata = {
  title: "Mint intake — Rockwell Ops",
  description: "Spectrometer XRF assay input, ultrasonic density logging, serial barcode tag printing.",
};

export default function Page() {
  return <IntakeClient />;
}
