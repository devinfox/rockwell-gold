import "server-only";

// Per-category derived data, computed once per server process instead of on
// every request.
//
// CatalogPage previously made about five full passes over the category on each
// request — building the mint list, counting in-stock items, averaging prices,
// then filtering and sorting — which cost ~200ms per hit on /silver (14,829
// products). All of it is derived from an immutable catalog, so it is cached
// here and keyed by route path.
//
// Prices are the one input that is not immutable: they come from the live
// engine and move with spot. The price-dependent layer (average, price sorts)
// is therefore keyed by the catalog price map and rebuilt whenever a new spot
// snapshot produces a new map, while the static layer stays cached.

import { availOf, type Product } from "./catalog";
import type { CatalogPriceMap } from "../lib/pricing/catalog-prices";

interface PricedLayer {
  prices: CatalogPriceMap;
  /** Mean live cash price over the products the engine prices; 0 when none. */
  avgPrice: number;
  /** Number of products with a live engine price. */
  pricedCount: number;
  /** Lazily-built price-sorted permutations, keyed by sort id. */
  sorted: Map<string, Product[]>;
}

export interface CategoryIndex {
  products: Product[];
  /** availOf(p).key per product, resolved once. */
  availKey: Map<Product, string>;
  mints: { slug: string; name: string }[];
  total: number;
  inStock: number;
  /** Lazily-built spot-independent sorted permutations, keyed by sort id. */
  sorted: Map<string, Product[]>;
  /** Spot-dependent layer; swapped when the live price map changes. */
  priced: PricedLayer;
}

const cache = new Map<string, CategoryIndex>();

function buildPriced(products: Product[], prices: CatalogPriceMap): PricedLayer {
  let pricedCount = 0;
  let priceSum = 0;
  for (const p of products) {
    const v = prices.get(p.id);
    if (v != null) {
      pricedCount++;
      priceSum += v;
    }
  }
  return { prices, avgPrice: pricedCount ? priceSum / pricedCount : 0, pricedCount, sorted: new Map() };
}

function build(products: Product[], prices: CatalogPriceMap): CategoryIndex {
  const availKey = new Map<Product, string>();
  const mintMap = new Map<string, string>();
  let inStock = 0;

  // Single pass for everything that used to take four.
  for (const p of products) {
    const key = availOf(p).key;
    availKey.set(p, key);
    if (key === "stock") inStock++;
    if (p.mintSlug && p.mint && !mintMap.has(p.mintSlug)) mintMap.set(p.mintSlug, p.mint);
  }

  return {
    products,
    availKey,
    mints: Array.from(mintMap, ([slug, name]) => ({ slug, name })),
    total: products.length,
    inStock,
    sorted: new Map([["featured", products]]),
    priced: buildPriced(products, prices),
  };
}

/**
 * Returns the cached index for a category, building it on first use.
 * `key` must uniquely identify the category — the route path is used.
 * `prices` is the live catalog price map for the current spot snapshot.
 */
export function categoryIndex(key: string, products: Product[], prices: CatalogPriceMap): CategoryIndex {
  let entry = cache.get(key);
  // Guard against a stale entry if the catalog is ever swapped underneath us.
  if (!entry || entry.products.length !== products.length) {
    entry = build(products, prices);
    cache.set(key, entry);
  } else if (entry.priced.prices !== prices) {
    entry.priced = buildPriced(products, prices);
  }
  return entry;
}

type Comparator = (a: Product, b: Product) => number;

/** Spot-independent orderings. */
const STATIC_COMPARATORS: Record<string, Comparator> = {
  "year-desc": (a, b) => (b.year ?? 0) - (a.year ?? 0),
  name: (a, b) => a.title.localeCompare(b.title),
};

/** Orderings over the live price map. Unpriced products always sort last, in catalog order. */
const PRICE_COMPARATORS: Record<string, (prices: CatalogPriceMap) => Comparator> = {
  "price-asc": (prices) => (a, b) => {
    const pa = prices.get(a.id), pb = prices.get(b.id);
    if (pa == null) return pb == null ? 0 : 1;
    if (pb == null) return -1;
    return pa - pb;
  },
  "price-desc": (prices) => (a, b) => {
    const pa = prices.get(a.id), pb = prices.get(b.id);
    if (pa == null) return pb == null ? 0 : 1;
    if (pb == null) return -1;
    return pb - pa;
  },
};

/** Sorted view of a whole category, computed once per sort order (and, for price sorts, per spot snapshot). */
export function sortedCategory(index: CategoryIndex, sort: string): Product[] {
  if (sort in PRICE_COMPARATORS) {
    const layer = index.priced;
    const cached = layer.sorted.get(sort);
    if (cached) return cached;
    const out = [...index.products].sort(PRICE_COMPARATORS[sort](layer.prices));
    layer.sorted.set(sort, out);
    return out;
  }

  const cached = index.sorted.get(sort);
  if (cached) return cached;

  const cmp = STATIC_COMPARATORS[sort];
  if (!cmp) return index.products;

  const out = [...index.products].sort(cmp);
  index.sorted.set(sort, out);
  return out;
}

export const hasComparator = (sort: string) => sort in STATIC_COMPARATORS || sort in PRICE_COMPARATORS;
