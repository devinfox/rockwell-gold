// Commercial rules: what Rockwell adds on top of metal value.
//
// Two layers:
//
//   1. SKU rules for the launch set live in app/data/launch-pricing.json and are
//      calibrated from competitor storefront observations (APMEX asks captured
//      2026-08-17..20 against the spot mark recorded at the same hour). They
//      carry the premium either in dollars per item or as a % of melt. See
//      scripts/build-launch-pricing.mts and ./launch-rules.ts.
//
//   2. The metal/series defaults below are the fallback for anything without a
//      launch rule, and they still supply the volume-tier curve, the margin
//      floor and the minimum premium for every quote.
//
// `costBasisUsd` (which nothing in the catalog currently carries) must be
// supplied before the margin floor can actually protect anything.

export type Metal = "gold" | "silver" | "platinum" | "palladium" | "copper" | "other";

/** Spot is quoted for these only; everything else cannot be priced from spot. */
export const SPOT_METALS = ["gold", "silver", "platinum", "palladium"] as const;
export type SpotMetal = (typeof SPOT_METALS)[number];

export const hasSpot = (metal: string): metal is SpotMetal =>
  (SPOT_METALS as readonly string[]).includes(metal);

export interface VolumeTier {
  minQty: number;
  maxQty?: number;
  /** Fraction taken OFF the premium (dollars or %), never off metal value. */
  premiumDiscountFrac: number;
  /** Short label for the storefront ladder. */
  label: string;
}

export interface PricingRule {
  id: string;
  scope: "SKU" | "SERIES" | "METAL";
  /** SKU code or a case-insensitive title match for SERIES rules. */
  target?: string;
  metal?: Metal;
  /** Premium as a fraction of metal value, e.g. 0.055 = +5.5%. */
  pctPremium: number;
  /** Floor premium in dollars per item; the engine takes the greater of the two. */
  minDollarPremium: number;
  volumeTiers: VolumeTier[];
  /** Minimum gross margin over cost basis. Inert until cost basis exists. */
  marginFloorPct: number;
}

// The APMEX 1 oz round ladder ran $8.99 → $8.69 → $8.39 → $7.99 over spot: each
// step trims the premium by a few percent, the last by ~11%. Three tiers are
// enough for the storefront; the shape matches.
export const STANDARD_TIERS: VolumeTier[] = [
  { minQty: 1, maxQty: 4, premiumDiscountFrac: 0, label: "1–4" },
  { minQty: 5, maxQty: 19, premiumDiscountFrac: 0.06, label: "5–19" },
  { minQty: 20, premiumDiscountFrac: 0.12, label: "20+" },
];

export const RULES: PricingRule[] = [
  // --- Metal-level defaults (lowest precedence) ---
  { id: "metal-gold", scope: "METAL", metal: "gold", pctPremium: 0.045,
    minDollarPremium: 40, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.015 },
  { id: "metal-silver", scope: "METAL", metal: "silver", pctPremium: 0.12,
    minDollarPremium: 2.5, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.035 },
  { id: "metal-platinum", scope: "METAL", metal: "platinum", pctPremium: 0.08,
    minDollarPremium: 45, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.025 },
  { id: "metal-palladium", scope: "METAL", metal: "palladium", pctPremium: 0.10,
    minDollarPremium: 50, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.025 },

  // --- Series rules (middle precedence) ---
  // Fractional gold carries a higher premium: minting cost per ounce is higher.
  { id: "series-gold-fractional", scope: "SERIES", target: "1/10 oz", metal: "gold",
    pctPremium: 0.11, minDollarPremium: 25, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.015 },
  { id: "series-gold-half", scope: "SERIES", target: "1/2 oz", metal: "gold",
    pctPremium: 0.075, minDollarPremium: 35, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.015 },
  // Large cast silver bars are sold on a per-ounce premium, not a percentage.
  { id: "series-silver-100oz", scope: "SERIES", target: "100 oz", metal: "silver",
    pctPremium: 0.045, minDollarPremium: 90, volumeTiers: STANDARD_TIERS, marginFloorPct: 0.035 },
];

/** Highest-precedence matching rule: SKU beats SERIES beats METAL. */
export function resolveRule(product: { sku?: string; title?: string; metal?: string }): PricingRule | null {
  const title = (product.title ?? "").toLowerCase();

  const bySku = RULES.find((r) => r.scope === "SKU" && r.target === product.sku);
  if (bySku) return bySku;

  const bySeries = RULES.find(
    (r) =>
      r.scope === "SERIES" &&
      r.metal === product.metal &&
      r.target &&
      title.includes(r.target.toLowerCase()),
  );
  if (bySeries) return bySeries;

  return RULES.find((r) => r.scope === "METAL" && r.metal === product.metal) ?? null;
}

export function tierFor(rule: PricingRule, qty: number): VolumeTier {
  return (
    rule.volumeTiers.find((t) => qty >= t.minQty && (t.maxQty === undefined || qty <= t.maxQty)) ??
    rule.volumeTiers[0]
  );
}

/**
 * Payment-method transform, applied to the finished cash price.
 *
 * Both APMEX and JM publish the cash (wire / ACH / check) price and derive the
 * card / PayPal column as cash ÷ 0.96 — the storefront math reconciles to the
 * cent ($75.11 ÷ 0.96 = $78.24). Rockwell settles crypto at the cash price.
 */
export const CASH_DISCOUNT = 0.04;

export const PAYMENT_RAILS = {
  crypto: { label: "Crypto / USDC", multiplier: 1, note: "cash price" },
  wire: { label: "Wire / ACH", multiplier: 1, note: "cash price" },
  card: { label: "Credit card", multiplier: 1 / (1 - CASH_DISCOUNT), note: "list price" },
} as const;

export type Rail = keyof typeof PAYMENT_RAILS;

/** Surcharge over the cash price for a rail, as a fraction (card ≈ 0.0417). */
export const railSurcharge = (rail: Rail): number => PAYMENT_RAILS[rail].multiplier - 1;
