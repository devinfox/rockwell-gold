import type { Metadata } from "next";
import CatalogPage from "../components/catalog-page";
import { onSale } from "../data/catalog";

export const metadata: Metadata = {
  title: "On Sale — Rockwell Metals",
  description: "Marked-down pieces across every mint on the Rockwell floor.",
};

export default async function Page({ searchParams }: PageProps<"/on-sale">) {
  const query = await searchParams;
  return (
    <CatalogPage
      index="S / On Sale"
      title="On sale."
      sub="Marked-down pieces across every mint on the floor — priced to move."
      crumbs={[{ label: "Home", href: "/" }, { label: "On sale" }]}
      products={onSale}
      currentPath="/on-sale"
      query={query}
      showMintFilter
    />
  );
}
