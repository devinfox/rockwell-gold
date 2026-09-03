import "server-only";

// Live price for a catalog product: the join between the launch rule book,
// the shared spot feed and the quote engine, shaped for the storefront.
//
// A centralized quote path (per the deep dive: "channel applications should
// display quotes, not reproduce pricing logic independently"). Catalog tiles,
// the PDP, /api/quote and the checkout lock all read from here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSpot, spotForEngine, type SpotQuote } from "../spot";
import { quoteProduct, type Quote } from "./quote";
import { PAYMENT_RAILS, STANDARD_TIERS, type Rail } from "./rules";
import type { LaunchRule, LaunchRuleBook } from "./launch-rules";
import type { PricingType } from "./classify";

/**
 * The rule book is load-bearing: without it every product silently falls back
 * to the static snapshot price, 99 of which sit below melt (audit: High). So a
 * missing or malformed file is fatal at startup rather than a quiet downgrade.
 * next.config.ts traces the file into the deploy bundle for the same reason.
 */
function loadBook(): LaunchRuleBook {
  const path = join(process.cwd(), "app", "data", "launch-pricing.json");
  let book: LaunchRuleBook;
  try {
    book = JSON.parse(readFileSync(path, "utf-8")) as LaunchRuleBook;
  } catch (err) {
    throw new Error(
      `[live-pricing] launch-pricing.json is missing or unreadable at ${path}. ` +
        `Run \`npx tsx scripts/build-launch-pricing.mts\` and make sure the file is deployed. (${err instanceof Error ? err.message : err})`,
    );
  }
  if (!book || typeof book !== "object" || !book.rules || Object.keys(book.rules).length === 0) {
    throw new Error("[live-pricing] launch-pricing.json contains no rules — refusing to start with an empty rule book.");
  }
  return book;
}

export const launchBook: LaunchRuleBook = loadBook();
export const launchRuleFor = (id: string): LaunchRule | null => launchBook.rules[id] ?? null;
export const isLaunchProduct = (id: string) => id in launchBook.rules;

export type LiveMode =
  /** Spot-linked: recalculated from the live mark on every read. */
  | "live"
  /** Merchant-set ask (true numismatic): fixed until the desk reprices; melt floor monitored. */
  | "fixed"
  /** Cannot be auto-priced (no rule, no ask, stale feed): request a quote. */
  | "enquire";

export interface LiveTier { minQty: number; maxQty?: number; label: string; unitCash: number; }

export interface LivePrice {
  id: string;
  mode: LiveMode;
  pricingType: PricingType;
  /** Cash (wire / ACH / crypto) unit price at qty 1. */
  cashPrice: number;
  railPrices: Record<Rail, number>;
  meltValue: number;
  premiumUsd: number;
  premiumPct: number;
  spotUsed: number;
  fineOz: number;
  tiers: LiveTier[];
  /** Spot observation time; null for fixed asks. */
  asOf: string | null;
  spotAgeSeconds: number;
  /** Mark is older than the cron cadence or not a market observation. */
  indicative: boolean;
  /** Melt has overtaken a fixed ask — desk must reprice. */
  meltFloorBinding: boolean;
  needsReview: boolean;
  calibration: LaunchRule["calibration"]["source"] | "none";
  /** One-line, customer-safe explanation of how the price was built. */
  explain: string;
  warnings: string[];
}

export interface LivePriceInput {
  id: string; sku: string; title: string; metal: string; year?: number | null;
  gradeFinish?: string | null; metalContent?: string | null; price?: number | null;
}

const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function explainQuote(q: Quote, rule: LaunchRule, spot: SpotQuote): string {
  const melt = `${q.fineOz} oz × ${usd(q.spotUsed)} spot = ${usd(q.meltValue)} metal value`;
  switch (q.pricingType) {
    case "TRUE_NUMISMATIC":
      return q.meltFloorBinding
        ? `Priced at the metal floor: ${melt} plus the minimum spread; the market ask sits below melt.`
        : `Market-set ask for this date, mint and grade. ${melt}; the ask carries ${usd(q.premiumUsd)} of collector value above metal.`;
    case "SEMI_NUMISMATIC":
      return `${melt} + ${usd(q.premiumUsd)} managed collector premium (${pct(q.premiumPctOfMelt)} over spot)${spot.live ? "" : " · indicative"}.`;
    default:
      return rule.premiumMode === "usd"
        ? `${melt} + ${usd(q.premiumUsd)} over spot (${pct(q.premiumPctOfMelt)}).`
        : `${melt} + ${pct(q.premiumPctOfMelt)} premium (${usd(q.premiumUsd)}).`;
  }
}

/** Pure: price one product against a given spot quote. Null when the product has no launch rule. */
export function priceWithSpot(p: LivePriceInput, spot: SpotQuote, qty = 1): LivePrice | null {
  const rule = launchRuleFor(p.id);
  if (!rule) return null;

  const enquire = (why: string, type: PricingType = rule.pricingType): LivePrice => ({
    id: p.id, mode: "enquire", pricingType: type, cashPrice: 0,
    railPrices: { crypto: 0, wire: 0, card: 0 }, meltValue: 0, premiumUsd: 0, premiumPct: 0,
    spotUsed: 0, fineOz: rule.fineOz, tiers: [], asOf: spot.live ? spot.asOf : null, spotAgeSeconds: spot.ageSeconds,
    indicative: true, meltFloorBinding: false, needsReview: true, calibration: rule.calibration.source,
    explain: why, warnings: [why],
  });

  if (!rule.live) return enquire("Not auto-priced: this piece needs a desk-set ask before it can be sold.");

  const spotLinked = rule.pricingType !== "TRUE_NUMISMATIC";
  if (spotLinked && spot.hardStale) {
    return enquire("Live pricing paused: the spot feed is stale. Request a quote and the desk will price against the current market.");
  }

  const input = { ...p, launchRule: rule };
  const engineSpot = spotForEngine(spot);
  const r = quoteProduct(input, engineSpot, qty);
  if (!r.ok) return enquire(`Not auto-priced (${r.reason.toLowerCase().replace(/_/g, " ")}).`);
  const q = r.quote;

  const tiers: LiveTier[] = STANDARD_TIERS.map((t) => {
    const tq = quoteProduct(input, engineSpot, t.minQty);
    return { minQty: t.minQty, maxQty: t.maxQty, label: t.label, unitCash: tq.ok ? tq.quote.cashPrice : q.cashPrice };
  });

  return {
    id: p.id,
    mode: spotLinked ? "live" : "fixed",
    pricingType: q.pricingType,
    cashPrice: q.cashPrice,
    railPrices: q.railPrices,
    meltValue: q.meltValue,
    premiumUsd: q.premiumUsd,
    premiumPct: q.premiumPctOfMelt,
    spotUsed: q.spotUsed,
    fineOz: q.fineOz,
    tiers,
    asOf: spot.live ? spot.asOf : null,
    spotAgeSeconds: spot.ageSeconds,
    indicative: spot.stale,
    meltFloorBinding: q.meltFloorBinding,
    needsReview: rule.needsReview,
    calibration: rule.calibration.source,
    explain: explainQuote(q, rule, spot),
    warnings: q.warnings.filter((w) => !w.startsWith("no cost basis")),
  };
}

/** Live price for one product at the current spot. */
export async function livePriceFor(p: LivePriceInput, qty = 1): Promise<LivePrice | null> {
  if (!isLaunchProduct(p.id)) return null;
  return priceWithSpot(p, await getSpot(), qty);
}

/** Live prices for a page of products, one spot read. */
export async function livePricesFor(items: LivePriceInput[]): Promise<Map<string, LivePrice>> {
  const out = new Map<string, LivePrice>();
  if (!items.some((p) => isLaunchProduct(p.id))) return out;
  const spot = await getSpot();
  for (const p of items) {
    const lp = priceWithSpot(p, spot, 1);
    if (lp) out.set(p.id, lp);
  }
  return out;
}

export const RAIL_LABELS = PAYMENT_RAILS;
