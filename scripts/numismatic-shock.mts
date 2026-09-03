// Shows how each pricing model responds as gold moves. The point: a rare coin's
// price is anchored to the coin market, not to metal — until metal overtakes it.
//
//   node --import ./scripts/ts-extension-hook.mjs scripts/numismatic-shock.mts

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteProduct, type SpotPrices } from "../app/lib/pricing/quote";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog: any[] = JSON.parse(readFileSync(join(ROOT, "app/data/products.json"), "utf8"));

const BASE: SpotPrices = { gold: 4454.40, silver: 66.39, platinum: 1819, palladium: 1405 };

const SUBJECTS = [
  ["BULLION_SPOT    ", (p: any) => p.sku === "RM-AU-AGE-1OZ-2026" && p.title.includes("1 oz")],
  ["SEMI_NUMISMATIC ", (p: any) => p.title === "1 oz Proof American Gold Eagle Coin"],
  ["TRUE_NUMISMATIC ", (p: any) => p.title.startsWith("1909-S $10 Indian Gold Eagle MS-65")],
] as const;

const MULT = [1, 1.5, 2, 3, 5, 8, 15];
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

console.log("Gold spot shock — how each model reprices\n");
console.log("model              " + MULT.map((m) => `gold x${m}`.padStart(11)).join(""));
console.log("-".repeat(19 + 11 * MULT.length));

for (const [label, match] of SUBJECTS) {
  const p = catalog.find(match);
  if (!p) { console.log(`${label} (not found)`); continue; }
  // Bootstrap the desk-managed figures ONCE at today's spot, then hold them —
  // which is how they must be persisted in production. Re-deriving them from the
  // static price on every quote breaks as soon as spot moves away from capture.
  const seed = quoteProduct(p, BASE, 1);
  const enriched = seed.ok
    ? {
        ...p,
        collectiblePremiumUsd: seed.quote.pricingType === "SEMI_NUMISMATIC" ? seed.quote.premiumUsd : undefined,
        merchantAskUsd: seed.quote.pricingType === "TRUE_NUMISMATIC" ? seed.quote.cashPrice : undefined,
      }
    : p;

  const row: string[] = [];
  const floorAt: boolean[] = [];
  for (const m of MULT) {
    const res = quoteProduct(enriched, { ...BASE, gold: BASE.gold * m }, 1);
    row.push(res.ok ? money(res.quote.cashPrice).padStart(11) : "  n/a".padStart(11));
    floorAt.push(res.ok ? res.quote.meltFloorBinding : false);
  }
  console.log(label + row.join(""));
  if (floorAt.some(Boolean)) {
    const marks = floorAt.map((f) => (f ? "melt floor".padStart(11) : "".padStart(11))).join("");
    console.log("                   " + marks);
  }
}

console.log("\nThe 1909-S holds its $30,495 collector ask while gold triples — it is priced");
console.log("by the coin market. Only once melt overtakes the ask does it track metal again.");
