import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPage from "../../../components/catalog-page";
import {
  findPlatinumSeries,
  PLATINUM_MINTS,
  PLATINUM_SERIES,
  platinumSeriesProducts,
} from "../../../data/catalog";

export function generateStaticParams() {
  const out: { mint: string; series: string }[] = [];
  for (const [mintSlug, seriesList] of Object.entries(PLATINUM_SERIES)) {
    for (const s of seriesList) {
      out.push({ mint: mintSlug, series: s.slug });
    }
  }
  return out;
}

export async function generateMetadata({
  params,
}: PageProps<"/platinum/[mint]/[series]">): Promise<Metadata> {
  const { mint, series } = await params;
  const m = PLATINUM_MINTS.find((x) => x.slug === mint);
  const s = findPlatinumSeries(mint, series);
  if (!m || !s) return { title: "Platinum — Rockwell Metals" };
  return {
    title: `${s.name} · ${m.name} Platinum — Rockwell Metals`,
    description: `All listed ${s.name} platinum products from ${m.name} on the Rockwell floor.`,
  };
}

export default async function Page({ params, searchParams }: PageProps<"/platinum/[mint]/[series]">) {
  const query = await searchParams;
  const { mint, series } = await params;
  const m = PLATINUM_MINTS.find((x) => x.slug === mint);
  const s = findPlatinumSeries(mint, series);
  if (!m || !s) notFound();
  const products = platinumSeriesProducts(m.slug, s.slug);
  return (
    <CatalogPage
      index={`P / ${m.name} / ${s.name}`}
      title={`${s.name}.`}
      sub={`${m.name} platinum series — ${products.length.toLocaleString("en-US")} ${products.length === 1 ? "piece" : "pieces"} on the floor.`}
      crumbs={[
        { label: "Home", href: "/" },
        { label: "Platinum", href: "/platinum" },
        { label: m.name, href: `/platinum/${m.slug}` },
        { label: s.name },
      ]}
      products={products}
      currentPath={`/platinum/${m.slug}/${s.slug}`}
      query={query}
    />
  );
}
