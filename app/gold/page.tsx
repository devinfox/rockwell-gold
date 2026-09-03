import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { gold } from "../data/catalog";

export const metadata: Metadata = {
  title: "All Gold — Rockwell Metals",
  description: "The full Rockwell gold catalog — every listed product across Perth Mint, Royal Canadian Mint, Royal Mint, and U.S. Mint.",
};

export default async function Page({ searchParams }: PageProps<"/gold">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="G / All Gold"
      title="All gold."
      sub="The full floor — every listed product across Perth Mint, Royal Canadian Mint, Royal Mint, and U.S. Mint. Filter it like a trading screen."
      crumbs={[{ label: "Home", href: "/" }, { label: "Gold", href: "/gold" }, { label: "All gold" }]}
      products={gold}
      currentPath="/gold"
      query={query}
      showMintFilter
    />
  );
}
