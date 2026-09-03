import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { otherMetals } from "../data/catalog";

export const metadata: Metadata = {
  title: "Copper & Other Metals — Rockwell Metals",
  description:
    "Copper rounds, bars and the remainder of the Rockwell catalog outside gold, silver and platinum — every SKU assay-verified and vault-eligible.",
};

// 966 products (216 copper + 750 other) previously had no browse route at all
// and were reachable only by direct product link (audit B-07).
export default async function Page({ searchParams }: PageProps<"/other-metals">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="O / Other Metals"
      title="Copper &amp; other metals."
      sub={`Everything on the floor outside the three precious metals — ${otherMetals.length.toLocaleString("en-US")} SKUs, searchable and sortable.`}
      crumbs={[{ label: "Home", href: "/" }, { label: "Other metals" }]}
      products={otherMetals}
      currentPath="/other-metals"
      query={query}
      showMintFilter
    />
  );
}
