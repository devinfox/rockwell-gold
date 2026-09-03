import type { MetadataRoute } from "next";
import { products, MINTS, PLATINUM_MINTS } from "./data/catalog";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://rockwellmetals.com";

// Google caps a sitemap at 50,000 URLs, so the catalog is chunked.
// In Next.js 16 the `id` parameter is async — see the bundled sitemap.md.
export const SITEMAP_CHUNK = 25_000;

export async function generateSitemaps() {
  const pages = Math.ceil(products.length / SITEMAP_CHUNK);
  return Array.from({ length: pages }, (_, i) => ({ id: i }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const n = Number(await id) || 0;
  const now = new Date();

  // Static and category routes ride along with the first chunk.
  const staticEntries: MetadataRoute.Sitemap =
    n === 0
      ? [
          { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1 },
          ...["/market", "/gold", "/silver", "/platinum", "/other-metals", "/best-sellers", "/new-arrivals", "/on-sale", "/drops"].map(
            (p) => ({ url: `${BASE}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 }),
          ),
          ...["/legal/about", "/legal/authentication", "/legal/custody-charter", "/legal/terms", "/legal/privacy", "/legal/disclosures"].map(
            (p) => ({ url: `${BASE}${p}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.4 }),
          ),
          ...MINTS.flatMap((m) => [
            { url: `${BASE}/gold/${m.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 },
            { url: `${BASE}/silver/${m.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 },
          ]),
          ...PLATINUM_MINTS.map((m) => ({
            url: `${BASE}/platinum/${m.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7,
          })),
        ]
      : [];

  const slice = products.slice(n * SITEMAP_CHUNK, (n + 1) * SITEMAP_CHUNK).map((p) => ({
    url: `${BASE}/product/${p.id}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticEntries, ...slice];
}
