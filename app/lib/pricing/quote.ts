// The quote engine: spot + catalog record -> a live price.
//
// Three pricing models, per the APMEX/JM deep-dive:
//
//   BULLION_SPOT     cash = (spot x fine oz) + max(pct x melt, min $)
//   SEMI_NUMISMATIC  cash = (spot x fine oz) + a managed DOLLAR premium
//   TRUE_NUMISMATIC  cash = max(merchant ask, melt x (1 + floor))
//
// The dollar premium on semi-numismatics is deliberate. A percentage premium on
// a proof coin would inflate the collector component every time gold rallied,
// which is not how the collector market behaves — the numismatic value is
// anchored in dollars while the metal leg floats.
//
// For true numismatics spot is a FLOOR, never the driver: a 1904 Double Eagle
// is worth what the coin market says, and melt only matters if metal rises far
// enough to overtake the collector ask.
//
// Deliberately pure: spot is passed in rather than fetched, so the same code
// runs on the server, in tests, and in the admin simulator.

import { resolveFineOz, type FineWeight } from "./fine-weight";
import type { LaunchRule } from "./launch-rules";
import { classify, type Classification, type PricingType } from "./classify";
import {
  PAYMENT_RAILS,
  hasSpot,
  resolveRule,
  tierFor,
  type PricingRule,
  type Rail,
} from "./rules";

export interface SpotPrices {
  gold: number;
  silver: number;
  platinum: number;
  palladium: number;
}

export interface QuoteInput {
  id?: string;
  sku?: string;
  title?: string;
  metal?: string;
  year?: number | null;
  gradeFinish?: string | null;
  metalContent?: string | null;
  /** Existing static catalog price. Treated as UNTRUSTED — see priceIsSane. */
  price?: number | null;
  /** Supplier acquisition cost. Absent from the catalog today. */
  costBasisUsd?: number | null;
  /** Desk-set ask for a true numismatic. Absent from the catalog today. */
  merchantAskUsd?: number | null;
  /** Desk-set collector premium in dollars for a semi-numismatic. */
  collectiblePremiumUsd?: number | null;
  /**
   * Competitor-calibrated SKU rule from app/data/launch-pricing.json. When
   * present it is the highest-precedence source for the premium, the collector
   * leg, the merchant ask and the fine weight.
   */
  launchRule?: LaunchRule | null;
}

export type QuoteFailure =
  | "NO_SPOT_FOR_METAL"
  | "NO_FINE_WEIGHT"
  | "NO_RULE"
  | "UNCLASSIFIED_PRODUCT"
  | "NEEDS_MERCHANT_ASK"
  | "NEEDS_COLLECTIBLE_PREMIUM";

export interface Quote {
  sku?: string;
  title?: string;
  metal: string;
  pricingType: PricingType;
  classification: Classification;
  fineOz: number;
  weight: FineWeight;
  rule: PricingRule;
  qty: number;
  spotUsed: number;
  meltValue: number;
  premiumUsd: number;
  premiumPctOfMelt: number;
  premiumFloored: boolean;
  cashPrice: number;
  /** True when the melt floor, not the collector ask, set the price. */
  meltFloorBinding: boolean;
  marginFloorApplied: number | null;
  railPrices: Record<Rail, number>;
  staticPrice: number | null;
  staticVsLiveDelta: number | null;
  staticImpliedPremiumPct: number | null;
  /** Non-fatal conditions a human should look at. */
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Payment-method transform. Both APMEX and JM publish a cash (wire/ACH/check)
 * price and derive the card/PayPal column as cash / 0.96 — a 4% cash discount
 * expressed the other way round. Wire settles at the cash price on Rockwell.
 */
export function railPricesFor(cashPrice: number): Record<Rail, number> {
  return Object.fromEntries(
    (Object.keys(PAYMENT_RAILS) as Rail[]).map((r) => [r, round2(cashPrice * PAYMENT_RAILS[r].multiplier)]),
  ) as Record<Rail, number>;
}

/**
 * A static catalog price is only usable as a premium source if it is at least
 * plausibly above melt. 758 gold records sit below half their melt value
 * (Double Eagles listed at $0.99), so an unguarded read would derive a negative
 * collector premium and quote far below metal.
 */
export function priceIsSane(price: number | null | undefined, meltValue: number): boolean {
  return typeof price === "number" && price > 0 && meltValue > 0 && price >= meltValue * 0.9;
}

export function quoteProduct(
  product: QuoteInput,
  spot: SpotPrices,
  qty = 1,
): { ok: true; quote: Quote } | { ok: false; reason: QuoteFailure; classification?: Classification } {
  const metal = (product.metal ?? "").toLowerCase();
  if (!hasSpot(metal)) return { ok: false, reason: "NO_SPOT_FOR_METAL" };

  const lr = product.launchRule ?? null;

  const weight: FineWeight | null = lr
    ? { fineOz: lr.fineOz, source: lr.weightSource, confidence: lr.weightConfidence }
    : resolveFineOz(product.metalContent, product.title);
  if (!weight) return { ok: false, reason: "NO_FINE_WEIGHT" };

  const rule = resolveRule({ sku: product.sku, title: product.title, metal });
  if (!rule) return { ok: false, reason: "NO_RULE" };

  const classification: Classification = lr
    ? { type: lr.pricingType, reasons: [`launch rule (${lr.calibration.source})`], confidence: lr.confidence }
    : classify(product);
  if (classification.type === "UNCLASSIFIED") {
    return { ok: false, reason: "UNCLASSIFIED_PRODUCT", classification };
  }

  const spotUsed = spot[metal];
  const meltValue = spotUsed * weight.fineOz;
  const warnings: string[] = [];

  const staticPrice = typeof product.price === "number" ? product.price : null;
  const staticUsable = priceIsSane(staticPrice, meltValue);
  if (staticPrice !== null && !staticUsable) {
    warnings.push(
      `static price ${staticPrice} is below 90% of melt (${round2(meltValue)}) — treated as bad data`,
    );
  }

  let cashPrice: number;
  let premiumUsd: number;
  let premiumFloored = false;
  let meltFloorBinding = false;

  if (classification.type === "TRUE_NUMISMATIC") {
    // Spot does not drive this item. Use the desk's ask; fall back to the
    // static price only if it clears the sanity check. Melt is the hard floor.
    const ask =
      typeof product.merchantAskUsd === "number" && product.merchantAskUsd > 0
        ? product.merchantAskUsd
        : typeof lr?.merchantAskUsd === "number" && lr.merchantAskUsd > 0
          ? lr.merchantAskUsd
          : staticUsable
            ? (staticPrice as number)
            : null;

    if (ask === null) {
      return { ok: false, reason: "NEEDS_MERCHANT_ASK", classification };
    }

    const meltFloor = meltValue * (1 + rule.marginFloorPct);
    cashPrice = Math.max(ask, meltFloor);
    meltFloorBinding = meltFloor > ask;
    premiumUsd = cashPrice - meltValue;

    if (meltFloorBinding) {
      warnings.push("melt has overtaken the collector ask — desk should reprice");
    } else if (ask < meltFloor * 1.1) {
      warnings.push("melt is within 10% of the ask — approaching the floor");
    }
  } else if (classification.type === "SEMI_NUMISMATIC") {
    // Metal leg floats; the collector leg is a fixed dollar amount.
    const collector =
      typeof product.collectiblePremiumUsd === "number"
        ? product.collectiblePremiumUsd
        : typeof lr?.collectiblePremiumUsd === "number"
          ? lr.collectiblePremiumUsd
          : staticUsable
            ? (staticPrice as number) - meltValue
            : null;

    if (collector === null) {
      return { ok: false, reason: "NEEDS_COLLECTIBLE_PREMIUM", classification };
    }

    // Never let the collector leg fall below the ordinary bullion premium.
    const bullionFloor = Math.max(meltValue * rule.pctPremium, rule.minDollarPremium);
    premiumUsd = Math.max(collector, bullionFloor);
    premiumFloored = premiumUsd > collector;
    cashPrice = meltValue + premiumUsd;
  } else {
    // BULLION_SPOT — the fully dynamic path.
    //
    // Per the APMEX/JM reconstruction, quantity changes the PREMIUM schedule,
    // never the metal leg: the tier discount is a fraction taken off the
    // premium. A competitor-calibrated launch rule supplies the premium either
    // as dollars per item (silver, small units — how both dealers publish it)
    // or as a percentage of melt (gold/platinum, so it scales with spot).
    const tier = tierFor(rule, qty);
    const keep = 1 - tier.premiumDiscountFrac;
    let basePremium: number;
    let floor: number;
    if (lr && lr.premiumMode === "usd") {
      basePremium = lr.premiumUsd * keep;
      floor = lr.minPremiumUsd;
    } else if (lr) {
      basePremium = meltValue * lr.premiumPct * keep;
      floor = lr.minPremiumUsd;
    } else {
      basePremium = meltValue * rule.pctPremium * keep;
      floor = rule.minDollarPremium;
    }
    premiumUsd = Math.max(basePremium, floor);
    premiumFloored = premiumUsd > basePremium;
    cashPrice = meltValue + premiumUsd;
  }

  // Margin floor over acquisition cost. Nothing in the catalog carries a cost
  // basis, so this branch never fires today — which is precisely the exposure.
  let marginFloorApplied: number | null = null;
  const cost = product.costBasisUsd;
  if (typeof cost === "number" && cost > 0) {
    const floor = cost * (1 + rule.marginFloorPct);
    if (cashPrice < floor) {
      marginFloorApplied = round2(floor);
      cashPrice = floor;
      premiumUsd = cashPrice - meltValue;
    }
  } else {
    warnings.push("no cost basis — margin floor cannot be enforced");
  }

  const railPrices = railPricesFor(cashPrice);

  return {
    ok: true,
    quote: {
      sku: product.sku,
      title: product.title,
      metal,
      pricingType: classification.type,
      classification,
      fineOz: weight.fineOz,
      weight,
      rule,
      qty,
      spotUsed: round2(spotUsed),
      meltValue: round2(meltValue),
      premiumUsd: round2(premiumUsd),
      premiumPctOfMelt: meltValue > 0 ? premiumUsd / meltValue : 0,
      premiumFloored,
      cashPrice: round2(cashPrice),
      meltFloorBinding,
      marginFloorApplied,
      railPrices,
      staticPrice,
      staticVsLiveDelta: staticPrice === null ? null : round2(staticPrice - cashPrice),
      staticImpliedPremiumPct:
        staticPrice !== null && meltValue > 0 ? staticPrice / meltValue - 1 : null,
      warnings,
    },
  };
}
