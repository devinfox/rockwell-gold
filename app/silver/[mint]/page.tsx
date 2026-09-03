import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPage from "../../components/catalog-page";
import { silverByMint, MINTS } from "../../data/catalog";

export function generateStaticParams() {
  return MINTS.map((m) => ({ mint: m.slug }));
}

export async function generateMetadata({ params }: PageProps<"/silver/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  return {
    title: `${m ? m.name : "Silver"} — Rockwell Metals`,
    description: m ? `All listed ${m.name} silver products in the Rockwell catalog.` : undefined,
  };
}

export default async function Page({ params, searchParams }: PageProps<"/silver/[mint]">) {
  const query = await searchParams;
  const { mint } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  if (!m) notFound();
  const products = silverByMint(m.slug);
  return (
    <CatalogPage
      index={`S / ${m.name}`}
      title={`${m.name} Silver.`}
      sub={`Every listed ${m.name} silver product on the floor — ${products.length.toLocaleString("en-US")} SKUs, searchable and sortable.`}
      crumbs={[{ label: "Home", href: "/" }, { label: "Silver", href: "/silver" }, { label: m.name }]}
      products={products}
      currentPath={`/silver/${m.slug}`}
      query={query}
    />
  );
}
