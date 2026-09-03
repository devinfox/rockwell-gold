// The catalog ⇄ Supabase row mapping must be lossless in both directions,
// including fields the app has not typed yet.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { productToRow, rowToProduct, ruleToRow, rowToRule, bookHeader, assembleBook, type ProductRow } from "../app/lib/catalog-sync";
import type { Product } from "../app/data/catalog";
import type { LaunchRuleBook } from "../app/lib/pricing/launch-rules";

const products = JSON.parse(readFileSync("app/data/products.json", "utf-8")) as Product[];
const book = JSON.parse(readFileSync("app/data/launch-pricing.json", "utf-8")) as LaunchRuleBook;

describe("catalog sync mapping", () => {
  it("round-trips every catalog product exactly", () => {
    for (let i = 0; i < products.length; i++) {
      const row = productToRow(products[i], i);
      expect(row.position).toBe(i);
      // PostgREST returns numeric columns as strings; the mapper must cope.
      const wire = { ...row, price: row.price === null ? null : String(row.price) } as unknown as ProductRow;
      expect(rowToProduct(wire)).toEqual(products[i]);
    }
  });

  it("keeps unknown fields in `extra` and restores them", () => {
    const p = { ...products[0], someFutureField: { nested: true }, anotherOne: 7 } as unknown as Product;
    const row = productToRow(p, 0);
    expect(row.extra).toEqual({ someFutureField: { nested: true }, anotherOne: 7 });
    expect(rowToProduct(row)).toEqual(p);
  });

  it("fills NOT NULL text columns for a sparse product and omits optional nulls on the way back", () => {
    const sparse = { id: "x", sku: "S", title: "T", price: null, metal: "gold", year: null } as unknown as Product;
    const row = productToRow(sparse, 3);
    expect(row.price_text).toBe("");
    expect(row.image).toBe("");
    expect(row.short_summary).toBeNull();
    const back = rowToProduct(row);
    expect(back).toEqual({ id: "x", sku: "S", title: "T", price: null, priceText: "", badge: "", mint: "", mintSlug: "", image: "", metal: "gold", year: null });
  });

  it("round-trips the rule book through rows + header", () => {
    const rows = Object.values(book.rules).map(ruleToRow);
    expect(rows.every((r) => r.pricing_type === r.rule.pricingType && r.live === r.rule.live)).toBe(true);
    const rebuilt = assembleBook(bookHeader(book), rows.map(rowToRule));
    expect(rebuilt).toEqual(book);
  });
});
