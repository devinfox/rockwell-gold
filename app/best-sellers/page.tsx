import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { bestSellers } from "../data/catalog";

export const metadata: Metadata = {
  title: "Best Sellers — Rockwell Metals",
  description: "The most-wanted pieces on the Rockwell floor — top picks across every mint.",
};

export default async function Page({ searchParams }: PageProps<"/best-sellers">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="B / Best Sellers"
      title="Best sellers."
      sub="The most-wanted pieces on the floor — top picks across every mint."
      crumbs={[{ label: "Home", href: "/" }, { label: "Best sellers" }]}
      products={bestSellers}
      currentPath="/best-sellers"
      query={query}
      showMintFilter
    />
  );
}
