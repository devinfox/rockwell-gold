import { describe, it, expect } from "vitest";
import { classify } from "../app/lib/pricing/classify";
import { parseFineOz, resolveFineOz } from "../app/lib/pricing/fine-weight";
import { quoteProduct, railPricesFor, type SpotPrices } from "../app/lib/pricing/quote";
import { PAYMENT_RAILS, railSurcharge, STANDARD_TIERS } from "../app/lib/pricing/rules";
import type { LaunchRule } from "../app/lib/pricing/launch-rules";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPOT: SpotPrices = { gold: 4492.4, silver: 67.19, platinum: 1835, palladium: 1447 };

const rule = (over: Partial<LaunchRule>): LaunchRule => ({
  id: "t", sku: "T", pricingType: "BULLION_SPOT", fineOz: 1, weightSource: "troy-oz", weightConfidence: "high",
  premiumMode: "usd", premiumUsd: 4.04, premiumPct: 0.06, minPremiumUsd: 2.5,
  calibration: { source: "apmex-observed", competitorPriceUsd: 70.59, spotAtObservation: 66.55, observedAt: "2026-08-17T16:01:47Z" },
  confidence: "high", live: true, needsReview: false, reviewReasons: [], ...over,
});

describe("payment transform (APMEX / JM reconstruction)", () => {
  it("derives the card column as cash ÷ 0.96 and settles wire at cash", () => {
    // Deep dive: $75.11 cash → $78.24 card/PayPal.
    const r = railPricesFor(75.11);
    expect(r.card).toBe(78.24);
    expect(r.wire).toBe(75.11);
    expect(railSurcharge("card")).toBeCloseTo(0.041667, 5);
    expect(PAYMENT_RAILS.card.multiplier).toBeCloseTo(1 / 0.96, 9);
  });
});

describe("competitor-calibrated bullion rule", () => {
  const maple = { id: "1", sku: "RM-AG-CML-1OZ-RANDOM", title: "1 oz Canadian Silver Maple Leaf Coin BU",
                  metal: "silver", gradeFinish: "Brilliant Uncirculated (BU)", metalContent: "1.0000 troy oz" };

  it("re-floats a dollar premium on live spot: melt moves, the premium does not", () => {
    const a = quoteProduct({ ...maple, launchRule: rule({}) }, SPOT, 1);
    const b = quoteProduct({ ...maple, launchRule: rule({}) }, { ...SPOT, silver: 80 }, 1);
    if (!a.ok || !b.ok) throw new Error("expected quotes");
    expect(a.quote.cashPrice).toBeCloseTo(67.19 + 4.04, 2);
    expect(b.quote.cashPrice).toBeCloseTo(80 + 4.04, 2);
    expect(b.quote.premiumUsd).toBe(a.quote.premiumUsd);
  });

  it("scales a percentage premium with melt for gold", () => {
    const eagle = { id: "2", sku: "AGE", title: "1/2 oz American Gold Eagle Coin BU (Random Year)", metal: "gold",
                    metalContent: "0.5000 troy oz",
                    launchRule: rule({ pricingType: "BULLION_SPOT", fineOz: 0.5, premiumMode: "pct", premiumPct: 0.0792, premiumUsd: 175.24, minPremiumUsd: 40 }) };
    const r = quoteProduct(eagle, SPOT, 1);
    if (!r.ok) throw new Error("expected quote");
    expect(r.quote.meltValue).toBeCloseTo(2246.2, 2);
    expect(r.quote.premiumUsd).toBeCloseTo(2246.2 * 0.0792, 1);
  });

  it("takes the volume tier off the premium only", () => {
    const one = quoteProduct({ ...maple, launchRule: rule({}) }, SPOT, 1);
    const twenty = quoteProduct({ ...maple, launchRule: rule({}) }, SPOT, 20);
    if (!one.ok || !twenty.ok) throw new Error("expected quotes");
    expect(twenty.quote.meltValue).toBe(one.quote.meltValue);
    expect(twenty.quote.premiumUsd).toBeCloseTo(4.04 * (1 - STANDARD_TIERS[2].premiumDiscountFrac), 2);
  });

  it("never lets the premium fall under the floor", () => {
    const bag = { ...maple, title: "90% Silver Walking Liberty Half Dollars ($100 Face Value Bag)", metalContent: "71.5 troy oz",
                  launchRule: rule({ fineOz: 71.5, premiumUsd: 0, premiumPct: 0, minPremiumUsd: 36.03 }) };
    const r = quoteProduct(bag, SPOT, 1);
    if (!r.ok) throw new Error("expected quote");
    expect(r.quote.premiumUsd).toBe(36.03);
    expect(r.quote.premiumFloored).toBe(true);
  });
});

describe("rare-coin path", () => {
  it("holds a merchant ask from the rule book while gold moves, floors at melt", () => {
    const p = { id: "x", sku: "X", title: "1909-S $10 Indian Gold Eagle MS-65", metal: "gold", year: 1909, metalContent: "0.4838 troy oz",
                launchRule: rule({ pricingType: "TRUE_NUMISMATIC", fineOz: 0.4838, premiumMode: "pct", merchantAskUsd: 30495 }) };
    const calm = quoteProduct(p, SPOT, 1);
    const shock = quoteProduct(p, { ...SPOT, gold: SPOT.gold * 20 }, 1);
    if (!calm.ok || !shock.ok) throw new Error("expected quotes");
    expect(calm.quote.cashPrice).toBe(30495);
    expect(calm.quote.meltFloorBinding).toBe(false);
    expect(shock.quote.meltFloorBinding).toBe(true);
  });

  it("uses a managed dollar collector leg for a semi-numismatic", () => {
    const p = { id: "m", sku: "M", title: "1878-1904 Morgan Silver Dollar Coin", metal: "silver", metalContent: "0.7734 troy oz",
                launchRule: rule({ pricingType: "SEMI_NUMISMATIC", fineOz: 0.7734, collectiblePremiumUsd: 28.94 }) };
    const r = quoteProduct(p, SPOT, 1);
    if (!r.ok) throw new Error("expected quote");
    expect(r.quote.premiumUsd).toBe(28.94);
    expect(r.quote.cashPrice).toBeCloseTo(0.7734 * 67.19 + 28.94, 2);
  });
});

describe("classification additions", () => {
  it("treats junk silver by face value as bullion regardless of coin dates", () => {
    expect(classify({ title: "90% Silver Walking Liberty Half Dollars ($100 Face Value Bag)", gradeFinish: "Average Circulated" }).type).toBe("BULLION_SPOT");
  });
  it("routes random-year classics to semi-numismatic, not true rarity", () => {
    expect(classify({ title: "1922-1935 Peace Silver Dollar (Random Year)", year: null, gradeFinish: "Other" }).type).toBe("SEMI_NUMISMATIC");
  });
  it("classifies CombiBars and assayed bars as bullion", () => {
    expect(classify({ title: "Valcambi 50 x 1 Gram Gold CombiBar™ (In Assay)", gradeFinish: "N/A" }).type).toBe("BULLION_SPOT");
  });
  it("reads fine weight from face value and multi-packs", () => {
    expect(resolveFineOz("N/A", "90% Silver Mercury Dime $100 Face Value Bag")?.fineOz).toBeCloseTo(71.5, 3);
    expect(parseFineOz("10 x 1/10 oz")?.fineOz).toBeCloseTo(1, 6);
    expect(parseFineOz("100 x 1 gram")?.fineOz).toBeCloseTo(3.215, 3);
  });
});

describe("launch rule book", () => {
  const book = JSON.parse(readFileSync(join(__dirname, "..", "app", "data", "launch-pricing.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(__dirname, "..", "app", "data", "products.json"), "utf8"));

  it("covers every product in the live catalog and nothing else", () => {
    expect(catalog.length).toBe(1000);
    expect(Object.keys(book.rules).length).toBe(1000);
    for (const p of catalog) expect(book.rules[String(p.id)]).toBeDefined();
  });

  it("only marks live products that the engine can actually price", () => {
    let live = 0;
    for (const p of catalog) {
      const r: LaunchRule = book.rules[String(p.id)];
      if (!r.live) continue;
      const q = quoteProduct({ ...p, launchRule: r }, SPOT, 1);
      expect(q.ok, `${p.id} ${p.title}`).toBe(true);
      if (q.ok) expect(q.quote.cashPrice).toBeGreaterThan(q.quote.meltValue * 0.99);
      live++;
    }
    expect(live).toBeGreaterThan(800);
  });

  it("never auto-prices a collector or rare piece from an inferred premium", () => {
    for (const r of Object.values(book.rules) as LaunchRule[]) {
      if (!r.live) continue;
      if (r.pricingType !== "BULLION_SPOT") expect(["apmex-observed", "jm-observed"], `${r.id}`).toContain(r.calibration.source);
    }
  });

  it("never carries a true-numismatic ask below 90% of its reference melt", () => {
    for (const p of catalog) {
      const r: LaunchRule = book.rules[String(p.id)];
      if (r.pricingType !== "TRUE_NUMISMATIC" || !r.merchantAskUsd) continue;
      const melt = (book.spotReference as unknown as Record<string, number>)[p.metal] * r.fineOz;
      expect(r.merchantAskUsd, `${p.id} ${p.title}`).toBeGreaterThanOrEqual(melt * 0.9);
    }
  });
});
