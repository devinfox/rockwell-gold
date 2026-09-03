import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { platinum } from "../data/catalog";

export const metadata: Metadata = {
  title: "Platinum & Palladium — Rockwell Metals",
  description: "Platinum and palladium coins, bars, and proof sets across U.S. Mint, Perth Mint, Royal Mint, and Royal Canadian Mint.",
};

export default async function Page({ searchParams }: PageProps<"/platinum">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="P / Platinum"
      title="Platinum & Palladium."
      sub="Platinum and palladium strikes across every major mint on the floor — bullion coins, proof pieces, and bars."
      crumbs={[{ label: "Home", href: "/" }, { label: "Platinum" }]}
      products={platinum}
      currentPath="/platinum"
      query={query}
      showMintFilter
    />
  );
}
