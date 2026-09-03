import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPage from "../../components/catalog-page";
import { byMint, MINTS } from "../../data/catalog";

export function generateStaticParams() {
  return MINTS.map((m) => ({ mint: m.slug }));
}

export async function generateMetadata({ params }: PageProps<"/gold/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  return {
    title: `${m ? m.name : "Gold"} — Rockwell Metals`,
    description: m ? `All listed ${m.name} products in the Rockwell gold catalog.` : undefined,
  };
}

export default async function Page({ params, searchParams }: PageProps<"/gold/[mint]">) {
  const query = await searchParams;
  const { mint } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  if (!m) notFound();
  const products = byMint(m.slug);
  return (
    <CatalogPage
      index={`G / ${m.name}`}
      title={`${m.name}.`}
      sub={`Every listed ${m.name} product on the floor — ${products.length.toLocaleString("en-US")} SKUs, searchable and sortable.`}
      crumbs={[{ label: "Home", href: "/" }, { label: "Gold", href: "/gold" }, { label: m.name }]}
      products={products}
      currentPath={`/gold/${m.slug}`}
      query={query}
    />
  );
}
