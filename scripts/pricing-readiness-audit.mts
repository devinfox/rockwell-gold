// Catalog-wide readiness audit for live pricing.
//   node --import ./scripts/ts-extension-hook.mjs scripts/pricing-readiness-audit.mts

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteProduct, priceIsSane, type SpotPrices } from "../app/lib/pricing/quote";
import { classify } from "../app/lib/pricing/classify";
import { resolveFineOz } from "../app/lib/pricing/fine-weight";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog: any[] = JSON.parse(readFileSync(join(ROOT, "app/data/products.json"), "utf8"));
const SPOT: SpotPrices = { gold: 4454.40, silver: 66.39, platinum: 1819, palladium: 1405 };

const N = catalog.length;
const pctOf = (n: number) => `${((100 * n) / N).toFixed(2)}%`;
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

const byType = new Map<string, number>();
const byFail = new Map<string, number>();
const bySkuCount = new Map<string, number>();
let priceable = 0, noWeight = 0, noSpotMetal = 0, nullPrice = 0, belowMelt = 0, lowConfWeight = 0;

for (const p of catalog) {
  bump(bySkuCount, p.sku ?? "<none>");
  bump(byType, classify(p).type);

  if (p.price === null || p.price === undefined) nullPrice++;
  const w = resolveFineOz(p.metalContent, p.title);
  if (!w) noWeight++;
  else if (w.confidence !== "high") lowConfWeight++;
  if (!["gold", "silver", "platinum", "palladium"].includes((p.metal ?? "").toLowerCase())) noSpotMetal++;

  const metal = (p.metal ?? "").toLowerCase();
  if (w && (SPOT as any)[metal]) {
    const melt = (SPOT as any)[metal] * w.fineOz;
    if (p.price !== null && p.price !== undefined && !priceIsSane(p.price, melt)) belowMelt++;
  }

  const res = quoteProduct(p, SPOT, 1);
  if (res.ok) priceable++; else bump(byFail, res.reason);
}

const dupeSkus = [...bySkuCount.values()].filter((c) => c > 1).length;
const dupeRows = [...bySkuCount.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);

console.log(`Catalog: ${N.toLocaleString()} products   (spot: gold $${SPOT.gold}, silver $${SPOT.silver})\n`);

console.log("PRICING MODEL ASSIGNED");
for (const [k, v] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${String(v).padStart(7)}  ${pctOf(v).padStart(7)}`);
}

console.log("\nAUTO-PRICEABLE FROM SPOT TODAY");
console.log(`  yes                ${String(priceable).padStart(7)}  ${pctOf(priceable).padStart(7)}`);
console.log(`  no                 ${String(N - priceable).padStart(7)}  ${pctOf(N - priceable).padStart(7)}`);
console.log("\n  blocked by:");
for (const [k, v] of [...byFail].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(26)} ${String(v).padStart(7)}  ${pctOf(v).padStart(7)}`);
}

console.log("\nDATA GAPS");
const gaps: [string, number][] = [
  ["cost basis present (margin floor)", 0],
  ["fine weight unparseable", noWeight],
  ["fine weight low/medium confidence", lowConfWeight],
  ["metal has no spot quote (other/copper)", noSpotMetal],
  ["price is null", nullPrice],
  ["price below 90% of melt (bad data)", belowMelt],
  ["duplicate SKU values", dupeSkus],
  ["records sharing a duplicated SKU", dupeRows],
];
for (const [label, n] of gaps) console.log(`  ${label.padEnd(40)} ${String(n).padStart(7)}  ${pctOf(n).padStart(7)}`);
