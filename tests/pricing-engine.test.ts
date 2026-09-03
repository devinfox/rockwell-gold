import { describe, it, expect } from "vitest";
import { parseFineOz, resolveFineOz } from "../app/lib/pricing/fine-weight";
import { classify } from "../app/lib/pricing/classify";
import { quoteProduct, priceIsSane, type SpotPrices } from "../app/lib/pricing/quote";

const SPOT: SpotPrices = { gold: 4454.4, silver: 66.39, platinum: 1819, palladium: 1405 };

describe("fine weight parsing", () => {
  it("reads a plain troy-oz figure", () => {
    expect(parseFineOz("1.0000 troy oz (31.1035 g)")?.fineOz).toBe(1);
  });

  it("treats the troy-oz figure as FINE content on alloyed coins", () => {
    // A .9167 Gold Eagle contains one FINE ounce; applying purity would be wrong.
    expect(parseFineOz("1.0000 troy oz (31.1035 g)")?.fineOz).toBe(1);
  });

  it("handles fractions, kilos and multi-packs", () => {
    expect(parseFineOz("1/2 oz (15.55 g)")?.fineOz).toBe(0.5);
    expect(parseFineOz("1.0000 kilogram (32.1507 troy oz)")?.fineOz).toBeCloseTo(32.1507, 3);
    expect(parseFineOz("500 x 1.0000 troy oz (15,552.50 g)")?.fineOz).toBe(500);
  });

  it("returns null rather than zero for unusable text", () => {
    expect(parseFineOz("N/A")).toBeNull();
    expect(parseFineOz("")).toBeNull();
    expect(resolveFineOz("N/A", "1 oz Silver Round")?.fineOz).toBe(1); // title fallback
  });
});

describe("classification", () => {
  it("routes pre-1933 coins to true numismatic", () => {
    expect(classify({ title: "1909-S $10 Indian Gold Eagle MS-65", year: 1909 }).type)
      .toBe("TRUE_NUMISMATIC");
  });

  it("routes graded modern issues to semi-numismatic", () => {
    expect(classify({ title: "2026-W 1 oz Burnished Gold Eagle MS-70 PCGS", year: 2026 }).type)
      .toBe("SEMI_NUMISMATIC");
  });

  it("does not mistake themed bullion for ancient coinage", () => {
    expect(classify({ title: "1 oz Silver Round - Zeus (Greek Mythology Series)", gradeFinish: "BU" }).type)
      .toBe("BULLION_SPOT");
  });

  it("refuses to guess when there is no signal", () => {
    expect(classify({ title: "Mystery Item", gradeFinish: "N/A" }).type).toBe("UNCLASSIFIED");
  });
});

describe("quoting", () => {
  const bullion = { sku: "X", title: "1 oz Gold Bar", metal: "gold", gradeFinish: "BU",
                    metalContent: "1.0000 troy oz (31.1035 g)", price: 4700 };

  it("prices bullion as melt plus premium", () => {
    const r = quoteProduct(bullion, SPOT, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.meltValue).toBeCloseTo(4454.4, 2);
    expect(r.quote.cashPrice).toBeCloseTo(4454.4 * 1.045, 1);
  });

  it("takes the volume discount out of the premium, never the metal", () => {
    const one = quoteProduct(bullion, SPOT, 1);
    const many = quoteProduct(bullion, SPOT, 20);
    if (!one.ok || !many.ok) throw new Error("expected quotes");
    expect(many.quote.cashPrice).toBeLessThan(one.quote.cashPrice);
    expect(many.quote.cashPrice).toBeGreaterThan(many.quote.meltValue);
  });

  it("holds a true numismatic's ask as gold rises, then floors at melt", () => {
    const rare = { sku: "R", title: "1909-S $10 Indian Gold Eagle MS-65", metal: "gold",
                   year: 1909, metalContent: "0.4838 troy oz", merchantAskUsd: 30495 };
    const flat = quoteProduct(rare, { ...SPOT, gold: SPOT.gold * 3 }, 1);
    if (!flat.ok) throw new Error("expected quote");
    expect(flat.quote.cashPrice).toBe(30495);
    expect(flat.quote.meltFloorBinding).toBe(false);

    const shocked = quoteProduct(rare, { ...SPOT, gold: SPOT.gold * 15 }, 1);
    if (!shocked.ok) throw new Error("expected quote");
    expect(shocked.quote.meltFloorBinding).toBe(true);
    expect(shocked.quote.cashPrice).toBeGreaterThan(30495);
  });

  it("refuses to price a rare coin from a corrupt static price", () => {
    // A 1904 Double Eagle listed at $0.99 must never become a $0.99 quote.
    const r = quoteProduct(
      { sku: "D", title: "1904 $20 Liberty Gold Double Eagle Coin", metal: "gold",
        year: 1904, metalContent: ".9675 troy oz (30.09 g)", price: 0.99 },
      SPOT, 1,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("NEEDS_MERCHANT_ASK");
  });

  it("rejects a static price that sits below melt", () => {
    expect(priceIsSane(0.99, 4309)).toBe(false);
    expect(priceIsSane(4700, 4454)).toBe(true);
  });

  it("will not price a metal with no spot quote", () => {
    const r = quoteProduct({ sku: "C", title: "1 oz Copper Round", metal: "other",
                             metalContent: "1.0000 troy oz" }, SPOT, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("NO_SPOT_FOR_METAL");
  });
});
