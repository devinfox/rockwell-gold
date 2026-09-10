import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Product = {
  id: string;
  sku: string;
  title: string;
  price: number | null;
  priceText: string;
  badge: string;
  mint: string;
  mintSlug: string;
  image: string;
  /** Multi-angle gallery; images[0] mirrors `image`. */
  images?: string[];
  metal: "gold" | "silver" | "platinum" | "palladium" | "copper" | "other";
  year: number | null;
  shortSummary?: string;
  fullDescription?: string;
  metalContent?: string;
  purity?: string;
  gradeFinish?: string;
  diameterMm?: string;
  thicknessMm?: string;
  faceValue?: string;
  iraEligible?: "Yes" | "No";
  obverseDescription?: string;
  reverseDescription?: string;
  tags?: string[];
  apmexReferenceUrl?: string;
  jmReferenceUrl?: string;
  /** Position in the launch set (1 = strongest demand signal). Present on the launch catalog only. */
  launchRank?: number;
};

/**
 * The catalog is read from disk at runtime rather than `import`ed.
 *
 * Importing an 81 MB JSON file makes it a bundler module: Turbopack spent ~4.6s
 * compiling it on the first catalog page hit, and it had to be re-processed on
 * every cold start. Reading the same file with fs costs ~150ms once per server
 * process (42ms read + 108ms parse) — roughly 30x cheaper — and keeps it out of
 * the module graph entirely.
 *
 * Every consumer is a Server Component, a Route Handler or a metadata route,
 * so this never reaches the browser (enforced by the server-only import above).
 */
function loadProducts(): Product[] {
  const path = join(process.cwd(), "app", "data", "products.json");
  return JSON.parse(readFileSync(path, "utf-8")) as Product[];
}

export const products: Product[] = loadProducts();

export const MINTS = [
  { name: "Perth Mint", slug: "perth-mint" },
  { name: "Royal Canadian Mint", slug: "royal-canadian-mint" },
  { name: "Royal Mint", slug: "royal-mint" },
  { name: "U.S. Mint", slug: "us-mint" },
] as const;

export const PLATINUM_MINTS = [
  { name: "U.S. Mint", slug: "us-mint" },
  { name: "The Perth Mint", slug: "perth-mint" },
  { name: "Royal Canadian Mint", slug: "royal-canadian-mint" },
  { name: "The Royal Mint", slug: "royal-mint" },
  { name: "Austrian Mint", slug: "austrian-mint" },
  { name: "Bars & Rounds", slug: "bars-rounds" },
  { name: "Platinum Coins", slug: "coins" },
  { name: "PAMP Suisse", slug: "pamp-suisse" },
  { name: "Valcambi", slug: "valcambi" },
  { name: "Credit Suisse", slug: "credit-suisse" },
  { name: "Baird & Co.", slug: "baird-co" },
  { name: "World & Other Mints", slug: "other-mints" },
] as const;

/** Category landing page for a product's metal. Palladium sits under /platinum; copper and the rest under /other-metals. */
export function metalHref(p: Pick<Product, "metal">): string {
  switch (p.metal) {
    case "gold": return "/gold";
    case "silver": return "/silver";
    case "platinum":
    case "palladium": return "/platinum";
    default: return "/other-metals";
  }
}

/**
 * Mint page for a product, or its metal landing page when no such route exists.
 *
 * Only the four MINTS have gold and silver pages and only PLATINUM_MINTS have
 * platinum pages; ~170 gold products (and every silver/platinum PDP) used to
 * link to `/gold/<mintSlug>`, which 404s for any other slug (audit: Medium).
 */
export function mintHref(p: Pick<Product, "metal" | "mintSlug">): string {
  const base = metalHref(p);
  const slug = p.mintSlug;
  if (!slug) return base;
  const known: readonly { slug: string }[] =
    p.metal === "gold" || p.metal === "silver" ? MINTS
    : p.metal === "platinum" || p.metal === "palladium" ? PLATINUM_MINTS
    : [];
  return known.some((m) => m.slug === slug) ? `${base}/${slug}` : base;
}

export const gold = products.filter((p) => p.metal === "gold");
export const silver = products.filter((p) => p.metal === "silver");
export const platinum = products.filter((p) => p.metal === "platinum" || p.metal === "palladium");
/** Copper and everything else in the catalog that has no metal page of its own. */
export const otherMetals = products.filter((p) => p.metal === "copper" || p.metal === "other");

export const byMint = (slug: string) => gold.filter((p) => p.mintSlug === slug);
export const silverByMint = (slug: string) => silver.filter((p) => p.mintSlug === slug);
export const platinumByMint = (slug: string) => {
  if (slug === "bars-rounds") {
    return platinum.filter((p) => /\b(bar|bars|ingot|ingots|round|rounds)\b/i.test(p.title) || ["pamp-suisse", "valcambi", "credit-suisse", "baird-co", "engelhard", "johnson-matthey", "argor-heraeus", "private-mint"].includes(p.mintSlug));
  }
  if (slug === "coins") {
    return platinum.filter((p) => !/\b(bar|bars|ingot|ingots)\b/i.test(p.title));
  }
  if (slug === "other-mints") {
    return platinum.filter((p) => !["us-mint", "perth-mint", "royal-canadian-mint", "royal-mint", "austrian-mint"].includes(p.mintSlug) && !/\b(bar|bars|ingot)\b/i.test(p.title));
  }
  return platinum.filter((p) => p.mintSlug === slug || (slug === "pamp-suisse" && /pamp/i.test(p.title)) || (slug === "valcambi" && /valcambi/i.test(p.title)) || (slug === "credit-suisse" && /credit suisse/i.test(p.title)) || (slug === "baird-co" && /baird/i.test(p.title)));
};

export const bestSellers = products.filter((p) => p.badge === "Top Pick");
export const newArrivals = products.filter(
  (p) => ["New", "Pre-Sale", "Coming Soon"].includes(p.badge) || (p.year ?? 0) >= 2026
);
export const onSale = products.filter((p) => p.badge === "Sale");

// The `badge` column in the source data mixes two different things: real
// availability ("In Stock", "Sale") and product classification ("Proof Strike",
// "Ingot", "Sovereign"). Reading it as availability alone left 13,050 products —
// 51% of the catalog — labelled "Call for price" next to a real price, and
// matching none of the filter buttons (audit B-06). They are separated here.

type Avail = { key: string; label: string; cls: string };

const AVAIL_BY_BADGE: Record<string, Avail> = {
  "In Stock": { key: "stock", label: "In stock", cls: "tag--stock" },
  "At Spot": { key: "stock", label: "At spot", cls: "tag--stock" },
  "Vault Intake": { key: "stock", label: "In stock", cls: "tag--stock" },
  "Sale": { key: "sale", label: "Sale", cls: "tag--sale" },
  "Top Pick": { key: "top", label: "Top pick", cls: "tag--top" },
  "Pre-Sale": { key: "pre", label: "Pre-sale", cls: "tag--pre" },
  "Coming Soon": { key: "pre", label: "Coming soon", cls: "tag--pre" },
  "New": { key: "pre", label: "New", cls: "tag--pre" },
  "AlertMe!®": { key: "notify", label: "Notify me", cls: "tag--mutedtag" },
  "Out of Stock": { key: "out", label: "Out of stock", cls: "tag--mutedtag" },
};

/**
 * Classification badges that say nothing about availability. A priced item
 * carrying one of these is simply in stock; an unpriced one is enquire-only.
 */
const CLASSIFICATION: Record<string, string> = {
  "Proof Strike": "Proof",
  "Perfect MS70": "MS70",
  "Ingot": "Ingot",
  "Sovereign": "Sovereign",
  "Rare Pick": "Rare",
  "Vault Intake": "Vault intake",
};

const IN_STOCK: Avail = { key: "stock", label: "In stock", cls: "tag--stock" };
const ENQUIRE: Avail = { key: "enquire", label: "Enquire", cls: "tag--mutedtag" };

export function availOf(p: Product): Avail {
  const mapped = AVAIL_BY_BADGE[p.badge];
  if (mapped) return mapped;
  // Unknown or classification-only badge: fall back to whether it can be bought.
  return p.price != null ? IN_STOCK : ENQUIRE;
}

/** Short chip describing what the piece *is*, when the badge carries that. Null when it doesn't. */
export function classOf(p: Product): string | null {
  return CLASSIFICATION[p.badge] ?? null;
}

export type SeriesDef = {
  slug: string;
  name: string;
  test?: (p: Product) => boolean;
  rest?: boolean;
};

// ————— Gold Series per Mint —————
export const SERIES: Record<string, SeriesDef[]> = {
  "us-mint": [
    {
      slug: "american-eagles",
      name: "American Eagles",
      test: (p) => /eagles?/i.test(p.title) && !((p.year != null && p.year <= 1933) || /saint-gaudens|st\. gaudens|double eagle|half eagle|quarter eagle|indian head|liberty head|coronet|classic head|panama-pacific|pan-pac|stella|\$20|\$10|\$5|\$2\.50|\$1 gold|pre-1933/i.test(p.title) && !/american\s+(gold\s+)?eagles?/i.test(p.title)),
    },
    { slug: "buffalos", name: "Buffalos", test: (p) => /buffalo/i.test(p.title) },
    {
      slug: "pre-1933",
      name: "Pre-1933 U.S. Gold",
      test: (p) => (p.year != null && p.year <= 1933) || (/saint-gaudens|st\. gaudens|double eagle|half eagle|quarter eagle|indian head|liberty head|coronet|classic head|panama-pacific|pan-pac|stella|\$20|\$10|\$5|\$2\.50|\$1 gold|pre-1933/i.test(p.title) && !/american\s+(gold\s+)?eagles?|buffalo|first spouse|american liberty|centennial/i.test(p.title)),
    },
    {
      slug: "commemoratives",
      name: "Commemoratives",
      test: (p) => /commem|first spouse|american liberty|liberty & britannia|anniversary|centennial|kennedy|mercury dime|standing liberty|walking liberty|proof set|mint set|ultra high relief/i.test(p.title),
    },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
  "perth-mint": [
    { slug: "lunar-series", name: "Lunar Series", test: (p) => /lunar|year of the/i.test(p.title) },
    { slug: "kangaroos", name: "Kangaroos", test: (p) => /kangaroo|nugget/i.test(p.title) },
    { slug: "kookaburras", name: "Kookaburras", test: (p) => /kookaburra/i.test(p.title) },
    { slug: "swans", name: "Swans", test: (p) => /swan/i.test(p.title) },
    { slug: "koalas", name: "Koalas", test: (p) => /koala/i.test(p.title) },
    { slug: "bars", name: "Bars", test: (p) => /\bbars?\b|minted bar|cast bar/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
  "royal-mint": [
    { slug: "britannias", name: "Britannias", test: (p) => /britannia/i.test(p.title) },
    { slug: "sovereigns", name: "Sovereigns", test: (p) => /sovereign|\bsov\.?\b|guinea/i.test(p.title) },
    { slug: "queens-beasts", name: "Queen's Beasts", test: (p) => /queen.?s beast/i.test(p.title) },
    { slug: "tudor-beasts", name: "Tudor Beasts", test: (p) => /tudor/i.test(p.title) },
    { slug: "myths-legends", name: "Myths & Legends", test: (p) => /myths|legends/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
  "royal-canadian-mint": [
    { slug: "maple-leafs", name: "Maple Leafs", test: (p) => /maple/i.test(p.title) },
    { slug: "five-nines", name: ".99999 Gold", test: (p) => /\.99999|\b99999\b|five nines/i.test(p.title) },
    { slug: "wildlife", name: "Wildlife Series", test: (p) => (/wildlife|call of the wild|howling wolf|growling cougar|roaring grizzly|moose|falcon|bison|elk|bear|polar|owl|animal|bald eagle|arctic fox/i.test(p.title)) && !/maple/i.test(p.title) },
    { slug: "bars", name: "Bars", test: (p) => /\bbars?\b/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
};

export function findSeries(mintSlug: string, seriesSlug: string) {
  return (SERIES[mintSlug] || []).find((s) => s.slug === seriesSlug);
}

export function seriesProducts(mintSlug: string, seriesSlug: string): Product[] {
  const defs = SERIES[mintSlug] || [];
  const def = defs.find((s) => s.slug === seriesSlug);
  if (!def) return [];
  const pool = byMint(mintSlug);
  if (def.rest) {
    const named = defs.filter((s) => !s.rest);
    return pool.filter((p) => !named.some((s) => s.test!(p)));
  }
  return pool.filter((p) => def.test!(p));
}

// ————— Silver Series per Mint —————
export const SILVER_SERIES: Record<string, SeriesDef[]> = {
  "us-mint": [
    { slug: "american-silver-eagles", name: "American Silver Eagles", test: (p) => /american\s+(silver\s+)?eagle|silver\s+eagle|\base\b/i.test(p.title) },
    { slug: "morgan-dollars", name: "Morgan Silver Dollars", test: (p) => /morgan/i.test(p.title) },
    { slug: "peace-dollars", name: "Peace Silver Dollars", test: (p) => /peace/i.test(p.title) },
    { slug: "junk-silver", name: "90% Junk Silver", test: (p) => /walking liberty|franklin half|barber|mercury dime|standing liberty|washington quarter|roosevelt dime|kennedy|90%|40%/i.test(p.title) },
    { slug: "commemoratives", name: "Commemoratives", test: (p) => /commem|dollar proof|silver dollar|medal|anniversary|centennial/i.test(p.title) },
    { slug: "proof-sets", name: "Silver Proof Sets", test: (p) => /proof set|mint set|silver set/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
  "perth-mint": [
    { slug: "silver-lunar", name: "Silver Lunar Series", test: (p) => /lunar|year of the/i.test(p.title) },
    { slug: "silver-kookaburras", name: "Silver Kookaburras", test: (p) => /kookaburra/i.test(p.title) },
    { slug: "silver-koalas", name: "Silver Koalas", test: (p) => /koala/i.test(p.title) },
    { slug: "silver-swans", name: "Silver Swans", test: (p) => /swan/i.test(p.title) },
    { slug: "silver-kangaroos", name: "Silver Kangaroos", test: (p) => /kangaroo/i.test(p.title) },
    { slug: "dragon-series", name: "Dragon & Rectangular", test: (p) => /dragon|rectangular/i.test(p.title) },
    { slug: "bars", name: "Silver Bars", test: (p) => /\bbars?\b|minted bar|cast bar/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
  "royal-mint": [
    { slug: "silver-britannias", name: "Silver Britannias", test: (p) => /britannia/i.test(p.title) },
    { slug: "queens-beasts", name: "Queen's Beasts", test: (p) => /queen.?s beast/i.test(p.title) },
    { slug: "tudor-beasts", name: "Tudor Beasts", test: (p) => /tudor/i.test(p.title) },
    { slug: "myths-legends", name: "Myths & Legends", test: (p) => /myths|legends|robin hood|maid marian|little john|king arthur|merlin/i.test(p.title) },
    { slug: "music-legends", name: "Music Legends", test: (p) => /music legends|david bowie|elton john|queen|freddie|rolling stones|police|wham|spice girls|pink floyd|george michael/i.test(p.title) },
    { slug: "royal-heritage", name: "Royal Heritage & Arms", test: (p) => /royal arms|city views|great engravers|gothic|sovereign|coronation|jubilee/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
  "royal-canadian-mint": [
    { slug: "silver-maples", name: "Silver Maple Leafs", test: (p) => /maple/i.test(p.title) },
    { slug: "wildlife-series", name: "Wildlife Series", test: (p) => (/wildlife|wolf|grizzly|cougar|moose|falcon|bison|elk|bear|polar|owl|animal|bald eagle|arctic fox|superleaf/i.test(p.title)) && !/maple/i.test(p.title) },
    { slug: "birds-landscapes", name: "Birds & Landscapes", test: (p) => /birds of canada|colorful birds|bird|landscape|national park|wondrous waters|heritage/i.test(p.title) && !/maple/i.test(p.title) },
    { slug: "pysanka-series", name: "Pysanka Easter Eggs", test: (p) => /pysanka|egg/i.test(p.title) },
    { slug: "silver-bars", name: "Silver Bars", test: (p) => /\bbars?\b/i.test(p.title) },
    { slug: "proof-sets", name: "Proof & Specimen Sets", test: (p) => /proof set|specimen set|uncirculated set|gift set/i.test(p.title) },
    { slug: "collectibles", name: "Collectibles", rest: true },
  ],
};

export function findSilverSeries(mintSlug: string, seriesSlug: string) {
  return (SILVER_SERIES[mintSlug] || []).find((s) => s.slug === seriesSlug);
}

export function silverSeriesProducts(mintSlug: string, seriesSlug: string): Product[] {
  const defs = SILVER_SERIES[mintSlug] || [];
  const def = defs.find((s) => s.slug === seriesSlug);
  if (!def) return [];
  const pool = silverByMint(mintSlug);
  if (def.rest) {
    const named = defs.filter((s) => !s.rest);
    return pool.filter((p) => !named.some((s) => s.test!(p)));
  }
  return pool.filter((p) => def.test!(p));
}

// ————— Platinum Series per Mint & Category —————
export const PLATINUM_SERIES: Record<string, SeriesDef[]> = {
  "us-mint": [
    { slug: "american-eagles", name: "American Platinum Eagles", test: (p) => !/proof|burnished|specimen|set|pr-?\d+|pf-?\d+/i.test(p.title) && /eagle|statue of liberty|bu\b|ms-?\d+|uncirculated/i.test(p.title) },
    { slug: "proof-eagles", name: "Proof Platinum Eagles", test: (p) => !/set|coin set/i.test(p.title) && /proof|pr-?\d+|pf-?\d+|dcam|ucam/i.test(p.title) },
    { slug: "burnished-eagles", name: "Burnished Platinum Eagles", test: (p) => !/set|coin set/i.test(p.title) && /burnished|\bsp-?\d+\b|specimen/i.test(p.title) },
    { slug: "sets", name: "Proof & Multi-Coin Sets", test: (p) => /set|coin set/i.test(p.title) },
  ],
  "bars-rounds": [
    { slug: "pamp-suisse", name: "PAMP Suisse", test: (p) => /pamp/i.test(p.title) || p.mintSlug === "pamp-suisse" },
    { slug: "valcambi", name: "Valcambi", test: (p) => /valcambi/i.test(p.title) || p.mintSlug === "valcambi" },
    { slug: "credit-suisse", name: "Credit Suisse", test: (p) => /credit suisse/i.test(p.title) || p.mintSlug === "credit-suisse" },
    { slug: "baird-co", name: "Baird & Co.", test: (p) => /baird/i.test(p.title) || p.mintSlug === "baird-co" },
    { slug: "cast-minted", name: "Cast & Secondary Market Bars", rest: true },
  ],
  "perth-mint": [
    { slug: "plat-koalas", name: "Platinum Koalas", test: (p) => /koala/i.test(p.title) },
    { slug: "plat-kangaroos", name: "Platinum Kangaroos", test: (p) => /kangaroo/i.test(p.title) },
    { slug: "plat-kookaburras", name: "Platinum Kookaburras", test: (p) => /kookaburra/i.test(p.title) },
    { slug: "plat-lunar", name: "Platinum Lunar Series", test: (p) => /lunar|year of/i.test(p.title) },
    { slug: "collectibles", name: "Perth Collectibles", rest: true },
  ],
  "royal-canadian-mint": [
    { slug: "plat-maples", name: "Platinum Maple Leafs", test: (p) => /maple/i.test(p.title) },
    { slug: "plat-sets", name: "Canadian Proof & Wildlife Sets", test: (p) => /set|owl|wildlife|animal/i.test(p.title) },
    { slug: "collectibles", name: "RCM Collectibles", rest: true },
  ],
  "royal-mint": [
    { slug: "plat-britannias", name: "Platinum Britannias", test: (p) => /britannia/i.test(p.title) },
    { slug: "queens-beasts", name: "Queen's & Tudor Beasts", test: (p) => /queen|tudor|beast/i.test(p.title) },
  ],
  "austrian-mint": [
    { slug: "philharmonics", name: "Austrian Philharmonics", test: (p) => /philharmonic|austria/i.test(p.title) },
  ],
  "other-mints": [
    { slug: "nobles-pandas", name: "Isle of Man Nobles & Chinese Pandas", test: (p) => /noble|panda|isle of man|china/i.test(p.title) },
    { slug: "south-african", name: "South African Big Five & Krugerrand", test: (p) => /big five|elephant|krugerrand|south africa/i.test(p.title) },
    { slug: "collectibles", name: "World Proofs & Collectibles", rest: true },
  ],
};

export function findPlatinumSeries(mintSlug: string, seriesSlug: string) {
  return (PLATINUM_SERIES[mintSlug] || []).find((s) => s.slug === seriesSlug);
}

export function platinumSeriesProducts(mintSlug: string, seriesSlug: string): Product[] {
  const defs = PLATINUM_SERIES[mintSlug] || [];
  const def = defs.find((s) => s.slug === seriesSlug);
  if (!def) return [];
  const pool = platinumByMint(mintSlug);
  if (def.rest) {
    const named = defs.filter((s) => !s.rest);
    return pool.filter((p) => !named.some((s) => s.test!(p)));
  }
  return pool.filter((p) => def.test!(p));
}
