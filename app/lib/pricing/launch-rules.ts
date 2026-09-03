// Shape of app/data/launch-pricing.json — one competitor-calibrated pricing
// rule per launch product, produced by scripts/build-launch-pricing.mts.
//
// Pure types + helpers only (no fs, no server-only) so the quote engine, the
// build script and the tests all share them.

import type { PricingType } from "./classify";
import type { WeightSource } from "./fine-weight";

export type LivePricingType = Exclude<PricingType, "UNCLASSIFIED">;

export type CalibrationSource =
  /** Premium derived from a competitor ask observed at a known spot mark. */
  | "apmex-observed"
  /** Same, from a JM Bullion ask whose listing title was verified against the product. */
  | "jm-observed"
  /** Median of observed premiums across the same product family. */
  | "family-median"
  /** Metal-level default; nothing comparable was observed. */
  | "metal-default"
  /** True numismatic with no observed ask: cannot be priced automatically. */
  | "none";

export interface LaunchRule {
  id: string;
  sku: string;
  pricingType: LivePricingType;

  fineOz: number;
  weightSource: WeightSource;
  weightConfidence: "high" | "medium" | "low";

  /**
   * BULLION_SPOT: how the premium is expressed.
   *  - "usd": a fixed dollar amount per item (silver coins/rounds/bars, junk
   *    silver, small units — how APMEX and JM publish "over spot").
   *  - "pct": a fraction of melt (gold / platinum / palladium, large bars) so
   *    the premium scales with the metal leg.
   */
  premiumMode: "usd" | "pct";
  premiumUsd: number;
  premiumPct: number;
  minPremiumUsd: number;

  /** SEMI_NUMISMATIC: managed collector leg in dollars; metal leg floats. */
  collectiblePremiumUsd?: number;
  /** TRUE_NUMISMATIC: fixed market ask; melt is only a floor. */
  merchantAskUsd?: number;

  calibration: {
    source: CalibrationSource;
    competitorPriceUsd?: number;
    spotAtObservation?: number;
    observedAt?: string;
    family?: string;
    peers?: number;
  };

  confidence: "high" | "medium" | "low";
  /** False → the storefront shows "Request a quote" instead of a price. */
  live: boolean;
  needsReview: boolean;
  reviewReasons: string[];
}

export type LaunchRuleBook = {
  version: number;
  generatedAt: string;
  spotReference: { gold: number; silver: number; platinum: number; palladium: number; asOf: string };
  rules: Record<string, LaunchRule>;
};
