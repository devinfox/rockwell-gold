import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { silver } from "../data/catalog";

export const metadata: Metadata = {
  title: "Silver — Rockwell Metals",
  description: "Silver coins, bars, and rare numismatics across every mint on the floor.",
};

export default async function Page({ searchParams }: PageProps<"/silver">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="S / Silver"
      title="Silver."
      sub="Silver strikes across every mint on the floor — bullion coins, historic 90% silver, and limited collector editions."
      crumbs={[{ label: "Home", href: "/" }, { label: "Silver" }]}
      products={silver}
      currentPath="/silver"
      query={query}
      showMintFilter
    />
  );
}
