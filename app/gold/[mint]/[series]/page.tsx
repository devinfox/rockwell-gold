import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPage from "../../../components/catalog-page";
import { findSeries, MINTS, SERIES, seriesProducts } from "../../../data/catalog";

export function generateStaticParams() {
  return Object.entries(SERIES).flatMap(([mint, defs]) =>
    defs.map((s) => ({ mint, series: s.slug }))
  );
}

export async function generateMetadata({ params }: PageProps<"/gold/[mint]/[series]">): Promise<Metadata> {
  const { mint, series } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  const s = findSeries(mint, series);
  return {
    title: m && s ? `${s.name} · ${m.name} — Rockwell Metals` : "Gold — Rockwell Metals",
    description: m && s ? `${s.name} from ${m.name} in the Rockwell gold catalog.` : undefined,
  };
}

export default async function Page({ params, searchParams }: PageProps<"/gold/[mint]/[series]">) {
  const query = await searchParams;
  const { mint, series } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  const s = findSeries(mint, series);
  if (!m || !s) notFound();
  const products = seriesProducts(mint, series);
  return (
    <CatalogPage
      index={`G / ${m.name} / ${s.name}`}
      title={`${s.name}.`}
      sub={`${s.name} from ${m.name} — ${products.length.toLocaleString("en-US")} SKUs, searchable and sortable.`}
      crumbs={[
        { label: "Home", href: "/" },
        { label: "Gold", href: "/gold" },
        { label: m.name, href: `/gold/${m.slug}` },
        { label: s.name },
      ]}
      products={products}
      currentPath={`/gold/${m.slug}/${s.slug}`}
      query={query}
    />
  );
}
