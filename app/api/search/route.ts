import "server-only";

// Server-side catalog search.
//
// The command palette used to import the whole `products` array into a client
// component, which pulled the entire 78 MB products.json into a client chunk
// loaded on every route (audit P-01), and then linear-scanned all 25,457
// records with four toLowerCase() calls per record on every keystroke (P-02).
// Searching happens here instead; the browser receives at most ten rows.
//
// Prices come from the live engine, not the static `priceText` column — that
// column carried the literal availability badge ("AlertMe!®") for 202 products
// and was rendered as if it were a price (audit: Medium).

import type { NextRequest } from "next/server";
import { products } from "../../data/catalog";
import { liveCatalogPrices } from "../../lib/pricing/catalog-prices";

interface IndexRow {
  id: string;
  title: string;
  sku: string;
  mint: string;
  metal: string;
  image: string;
  haystack: string;
}

interface SearchResult {
  id: string;
  title: string;
  sku: string;
  mint: string;
  metal: string;
  image: string;
  /** Live cash price at qty 1; null when the engine does not price this piece. */
  cashPrice: number | null;
  /** Display text derived from `cashPrice` — "Quote" when there is none. */
  priceText: string;
}

/** Built once per server process, lowercased up front rather than per keystroke. */
let index: IndexRow[] | null = null;
function getIndex(): IndexRow[] {
  if (!index) {
    index = products.map((p) => ({
      id: p.id,
      title: p.title,
      sku: p.sku,
      mint: p.mint,
      metal: p.metal,
      image: p.image,
      haystack: `${p.title} ${p.sku} ${p.mint} ${p.metal}`.toLowerCase(),
    }));
  }
  return index;
}

const LIMIT = 10;
/** Longest query scanned; anything beyond this is noise, not a SKU or a title. */
const MAX_QUERY = 80;

const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, MAX_QUERY).trim().toLowerCase();
  if (q.length < 2) return Response.json({ results: [] });

  const rows = getIndex();
  const out: IndexRow[] = [];
  // Early exit: stop scanning as soon as the page is full.
  for (let i = 0; i < rows.length && out.length < LIMIT; i++) {
    if (rows[i].haystack.includes(q)) out.push(rows[i]);
  }

  const prices = out.length ? await liveCatalogPrices() : null;
  const results: SearchResult[] = out.map((r) => {
    const cashPrice = prices?.get(r.id) ?? null;
    return {
      id: r.id, title: r.title, sku: r.sku, mint: r.mint, metal: r.metal, image: r.image,
      cashPrice, priceText: cashPrice != null ? usd(cashPrice) : "Quote",
    };
  });

  return Response.json(
    { results },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
