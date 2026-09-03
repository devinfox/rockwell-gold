import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPage from "../../../components/catalog-page";
import { findSilverSeries, MINTS, SILVER_SERIES, silverSeriesProducts } from "../../../data/catalog";

export function generateStaticParams() {
  const out: { mint: string; series: string }[] = [];
  for (const [mintSlug, seriesList] of Object.entries(SILVER_SERIES)) {
    for (const s of seriesList) {
      out.push({ mint: mintSlug, series: s.slug });
    }
  }
  return out;
}

export async function generateMetadata({
  params,
}: PageProps<"/silver/[mint]/[series]">): Promise<Metadata> {
  const { mint, series } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  const s = findSilverSeries(mint, series);
  if (!m || !s) return { title: "Silver — Rockwell Metals" };
  return {
    title: `${s.name} · ${m.name} Silver — Rockwell Metals`,
    description: `All listed ${s.name} silver products from the ${m.name} on the Rockwell floor.`,
  };
}

export default async function Page({ params, searchParams }: PageProps<"/silver/[mint]/[series]">) {
  const query = await searchParams;
  const { mint, series } = await params;
  const m = MINTS.find((x) => x.slug === mint);
  const s = findSilverSeries(mint, series);
  if (!m || !s) notFound();
  const products = silverSeriesProducts(m.slug, s.slug);
  return (
    <CatalogPage
      index={`S / ${m.name} / ${s.name}`}
      title={`${s.name}.`}
      sub={`${m.name} silver series — ${products.length.toLocaleString("en-US")} ${products.length === 1 ? "piece" : "pieces"} on the floor.`}
      crumbs={[
        { label: "Home", href: "/" },
        { label: "Silver", href: "/silver" },
        { label: m.name, href: `/silver/${m.slug}` },
        { label: s.name },
      ]}
      products={products}
      currentPath={`/silver/${m.slug}/${s.slug}`}
      query={query}
    />
  );
}
