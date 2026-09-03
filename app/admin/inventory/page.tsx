import type { Metadata } from "next";
import { InventoryClient } from "./inventory-clients";

export const metadata: Metadata = {
  title: "Stock registry — Rockwell Ops",
  description: "Master bullion inventory by metal, mint, SKU and vault bay with reorder triggers.",
};

export default function Page() {
  return <InventoryClient />;
}
