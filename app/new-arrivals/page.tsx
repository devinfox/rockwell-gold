import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { newArrivals } from "../data/catalog";

export const metadata: Metadata = {
  title: "New Arrivals — Rockwell Metals",
  description: "Fresh strikes and pre-sales — the newest listings on the Rockwell floor.",
};

export default async function Page({ searchParams }: PageProps<"/new-arrivals">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="N / New Arrivals"
      title="New arrivals."
      sub="Fresh strikes, pre-sales, and the newest listings on the floor."
      crumbs={[{ label: "Home", href: "/" }, { label: "New arrivals" }]}
      products={newArrivals}
      currentPath="/new-arrivals"
      query={query}
      showMintFilter
    />
  );
}
