import type { MetadataRoute } from "next";
import { products } from "./data/catalog";
import { SITEMAP_CHUNK } from "./sitemap";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://rockwellmetals.com";

export default function robots(): MetadataRoute.Robots {
  // generateSitemaps emits chunked files at /sitemap/{id}.xml — there is no
  // single /sitemap.xml, so every chunk is listed explicitly.
  const chunks = Math.max(1, Math.ceil(products.length / SITEMAP_CHUNK));

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Account, staff and API surfaces should never be indexed.
      disallow: ["/admin", "/api", "/vault", "/orders", "/checkout", "/tax-center", "/auth"],
    },
    sitemap: Array.from({ length: chunks }, (_, i) => `${BASE}/sitemap/${i}.xml`),
  };
}
