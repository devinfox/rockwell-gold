#!/usr/bin/env npx tsx
// Uploads the local catalog to Supabase (the system of record):
//   app/data/products.json        → rockwell_products
//   app/data/launch-pricing.json  → rockwell_pricing_rules + rockwell_catalog_meta
//
// Idempotent upsert on id. Products no longer in the local file are removed
// from the table (pass --keep-missing to leave them). Run after any local
// catalog edit or rule-book repair:
//
//   npx tsx scripts/catalog-push.mts [--dry-run] [--keep-missing]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, Rest } from "./lib/supabase-rest";
import { TABLES, META_KEY_BOOK, productToRow, ruleToRow, bookHeader } from "../app/lib/catalog-sync";
import type { Product } from "../app/data/catalog";
import type { LaunchRuleBook } from "../app/lib/pricing/launch-rules";

const ROOT = join(import.meta.dirname, "..");
loadEnv(ROOT);
const dry = process.argv.includes("--dry-run");
const keepMissing = process.argv.includes("--keep-missing");

const products = JSON.parse(readFileSync(join(ROOT, "app", "data", "products.json"), "utf-8")) as Product[];
const book = JSON.parse(readFileSync(join(ROOT, "app", "data", "launch-pricing.json"), "utf-8")) as LaunchRuleBook & { repairs?: unknown[] };

const ids = new Set(products.map((p) => p.id));
if (ids.size !== products.length) throw new Error("products.json has duplicate ids");
const productRows = products.map((p, i) => productToRow(p, i));
const ruleRows = Object.values(book.rules).filter((r) => ids.has(r.id)).map(ruleToRow);
const orphanRules = Object.values(book.rules).length - ruleRows.length;

console.log(`catalog-push: ${productRows.length} products, ${ruleRows.length} pricing rules${orphanRules ? ` (${orphanRules} rules without a product skipped)` : ""}, book v${book.version}`);
if (dry) {
  console.log("dry run — nothing written");
  process.exit(0);
}

const rest = new Rest();
const t0 = Date.now();
await rest.upsert(TABLES.products, productRows, 200, (n: number) => process.stdout.write(`\r  products ${n}/${productRows.length}`));
process.stdout.write("\n");
await rest.upsert(TABLES.rules, ruleRows, 200, (n: number) => process.stdout.write(`\r  rules    ${n}/${ruleRows.length}`));
process.stdout.write("\n");
await rest.upsert(TABLES.meta, [{ key: META_KEY_BOOK, value: bookHeader(book), updated_at: new Date().toISOString() }]);

if (!keepMissing) {
  const removedRules = await rest.deleteNotIn(TABLES.rules, [...ids]);
  const removedProducts = await rest.deleteNotIn(TABLES.products, [...ids]);
  if (removedProducts || removedRules) console.log(`  removed ${removedProducts} stale products, ${removedRules} stale rules`);
}

const [np, nr] = await Promise.all([rest.count(TABLES.products), rest.count(TABLES.rules)]);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — table counts: products ${np}, rules ${nr}`);
if (np !== productRows.length || nr !== ruleRows.length) {
  console.error("count mismatch after push");
  process.exit(1);
}
