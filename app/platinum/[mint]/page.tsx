import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPage from "../../components/catalog-page";
import { PLATINUM_MINTS, platinumByMint } from "../../data/catalog";

export function generateStaticParams() {
  return PLATINUM_MINTS.map((m) => ({ mint: m.slug }));
}

export async function generateMetadata({ params }: PageProps<"/platinum/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  const m = PLATINUM_MINTS.find((x) => x.slug === mint);
  return {
    title: `${m ? m.name : "Platinum"} — Rockwell Metals`,
    description: m ? `All listed ${m.name} platinum & palladium products in the Rockwell catalog.` : undefined,
  };
}

export default async function Page({ params, searchParams }: PageProps<"/platinum/[mint]">) {
  const query = await searchParams;
  const { mint } = await params;
  const m = PLATINUM_MINTS.find((x) => x.slug === mint);
  if (!m) notFound();
  const products = platinumByMint(m.slug);
  return (
    <CatalogPage
      index={`P / ${m.name}`}
      title={`${m.name} Platinum.`}
      sub={`Every listed ${m.name} platinum strike on the floor — ${products.length.toLocaleString("en-US")} ${products.length === 1 ? "SKU" : "SKUs"}, searchable and sortable.`}
      crumbs={[{ label: "Home", href: "/" }, { label: "Platinum", href: "/platinum" }, { label: m.name }]}
      products={products}
      currentPath={`/platinum/${m.slug}`}
      query={query}
      showMintFilter
    />
  );
}
