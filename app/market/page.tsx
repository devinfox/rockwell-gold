import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { products } from "../data/catalog";

export const metadata: Metadata = {
  title: "Market — Verified physical metal, priced live · Rockwell Metals",
  description:
    "Browse Rockwell's full market floor: coins and bars filterable by mint, availability and price. Every SKU assay-verified, vault-eligible and instantly sell-backable.",
};

// The market floor now renders the real catalog. It previously carried fourteen
// hardcoded demo tiles, all linking to a single fixed /product page, so none of
// the 25,457 catalogued products were reachable from it (audit B-01). That page
// also carried the dead `data-wclassName` weight filter (audit B-02), which is
// gone with it — filtering is server-side now.
export default async function Page({ searchParams }: PageProps<"/market">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="M / Market Floor"
      title="The market floor."
      sub="Every coin and bar on the floor — assay-verified, vault-eligible and instantly sell-backable. Filter it like a trading screen."
      crumbs={[{ label: "Home", href: "/" }, { label: "Market" }]}
      products={products}
      currentPath="/market"
      query={query}
      showMintFilter
    />
  );
}
