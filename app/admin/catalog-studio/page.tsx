import React from "react";
import { CatalogStudioClient } from "./catalog-studio-client";

export const metadata = {
  title: "Catalog Studio · Rockwell Metals Operations",
  description: "Dual-source bullion ingestion, crawler matching, and 4-layer AI catalog synthesizer.",
};

export default function CatalogStudioPage() {
  return <CatalogStudioClient />;
}
