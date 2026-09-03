import "server-only";

// Whole-catalog live cash prices, computed once per spot snapshot.
//
// Catalog sorting, the "avg price" strip and /api/search used to read the
// static `price` column from products.json while the tiles next to them showed
// the live engine quote (audit: Medium). Everything that needs a price for
// more than one page of products now reads this map instead, so a sort by
// price and the price printed on the tile can never disagree.
//
// Products outside the launch rule book, and pieces the engine declines to
// price ("enquire"), are null: they sort last and are shown as "Quote".

import { products } from "../../data/catalog";
import { getSpot, type SpotQuote } from "../spot";
import { isLaunchProduct, priceWithSpot } from "./live";

export type CatalogPriceMap = ReadonlyMap<string, number | null>;

let cached: { asOf: string; live: boolean; prices: CatalogPriceMap } | null = null;

/** Live cash price (qty 1) per product id for the given spot snapshot. Memoised on `spot.asOf`. */
export function catalogCashPrices(spot: SpotQuote): CatalogPriceMap {
  // `live` is part of the key so a fallback mark (asOf = epoch) never masks a
  // later real observation with the same timestamp.
  if (cached && cached.asOf === spot.asOf && cached.live === spot.live) return cached.prices;

  const prices = new Map<string, number | null>();
  for (const p of products) {
    if (!isLaunchProduct(p.id)) {
      prices.set(p.id, null);
      continue;
    }
    const lp = priceWithSpot(p, spot, 1);
    prices.set(p.id, lp && lp.mode !== "enquire" && lp.cashPrice > 0 ? lp.cashPrice : null);
  }
  cached = { asOf: spot.asOf, live: spot.live, prices };
  return prices;
}

/** Same map at the current spot mark (one memoised spot read). */
export async function liveCatalogPrices(): Promise<CatalogPriceMap> {
  return catalogCashPrices(await getSpot());
}
