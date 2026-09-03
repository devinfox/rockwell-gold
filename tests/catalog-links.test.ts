import { describe, it, expect } from "vitest";
import { metalHref, mintHref, MINTS, PLATINUM_MINTS, type Product } from "../app/data/catalog";
import { categoryIndex, sortedCategory, hasComparator } from "../app/data/catalog-index";

const product = (over: Partial<Product>): Product => ({
  id: "x", sku: "X", title: "Piece", price: null, priceText: "", badge: "In Stock",
  mint: "Some Mint", mintSlug: "some-mint", image: "", metal: "gold", year: null, ...over,
});

describe("mintHref — mint links only where a mint page exists (audit: ~170 gold PDPs 404'd)", () => {
  it("links gold and silver to the four MINTS pages, otherwise to the metal landing page", () => {
    for (const m of MINTS) {
      expect(mintHref(product({ metal: "gold", mintSlug: m.slug }))).toBe(`/gold/${m.slug}`);
      expect(mintHref(product({ metal: "silver", mintSlug: m.slug }))).toBe(`/silver/${m.slug}`);
    }
    expect(mintHref(product({ metal: "gold", mintSlug: "pamp-suisse" }))).toBe("/gold");
    expect(mintHref(product({ metal: "silver", mintSlug: "sunshine-mint" }))).toBe("/silver");
    expect(mintHref(product({ metal: "gold", mintSlug: "" }))).toBe("/gold");
  });

  it("links platinum and palladium to PLATINUM_MINTS pages, otherwise to /platinum", () => {
    for (const m of PLATINUM_MINTS) {
      expect(mintHref(product({ metal: "platinum", mintSlug: m.slug }))).toBe(`/platinum/${m.slug}`);
    }
    expect(mintHref(product({ metal: "palladium", mintSlug: "us-mint" }))).toBe("/platinum/us-mint");
    expect(mintHref(product({ metal: "platinum", mintSlug: "no-such-mint" }))).toBe("/platinum");
  });

  it("never sends copper or other metals to /gold", () => {
    expect(metalHref(product({ metal: "copper" }))).toBe("/other-metals");
    expect(mintHref(product({ metal: "other", mintSlug: "us-mint" }))).toBe("/other-metals");
    expect(metalHref(product({ metal: "palladium" }))).toBe("/platinum");
  });
});

describe("categoryIndex — sorting and averages use the live price map, not the static column", () => {
  const items = [
    product({ id: "a", title: "A", price: 10 }),
    product({ id: "b", title: "B", price: 5000 }),
    product({ id: "c", title: "C", price: 20 }),
    product({ id: "d", title: "D", price: 1 }),
  ];
  const prices = new Map<string, number | null>([["a", 300], ["b", null], ["c", 100], ["d", null]]);

  it("orders by live cash price and puts unpriced products last, in catalog order", () => {
    const index = categoryIndex("test/links/1", items, prices);
    expect(sortedCategory(index, "price-asc").map((p) => p.id)).toEqual(["c", "a", "b", "d"]);
    expect(sortedCategory(index, "price-desc").map((p) => p.id)).toEqual(["a", "c", "b", "d"]);
    expect(hasComparator("price-asc")).toBe(true);
    expect(hasComparator("name")).toBe(true);
    expect(hasComparator("nope")).toBe(false);
  });

  it("averages only live-priced products", () => {
    const index = categoryIndex("test/links/2", items, prices);
    expect(index.priced.pricedCount).toBe(2);
    expect(index.priced.avgPrice).toBe(200);
  });

  it("rebuilds the price layer when a new spot snapshot yields a new map, keeping the static index", () => {
    const first = categoryIndex("test/links/3", items, prices);
    const byName = sortedCategory(first, "name");
    const next = new Map<string, number | null>([["a", 50], ["b", 10], ["c", 100], ["d", null]]);
    const second = categoryIndex("test/links/3", items, next);
    expect(second).toBe(first);
    expect(sortedCategory(second, "name")).toBe(byName);
    expect(sortedCategory(second, "price-asc").map((p) => p.id)).toEqual(["b", "a", "c", "d"]);
    expect(second.priced.avgPrice).toBeCloseTo((50 + 10 + 100) / 3, 9);
  });
});
