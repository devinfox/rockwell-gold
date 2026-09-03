#!/usr/bin/env npx tsx
// Downloads the catalog from Supabase into the local snapshot files the app
// reads at startup:
//   rockwell_products                          → app/data/products.json
//   rockwell_pricing_rules + rockwell_catalog_meta → app/data/launch-pricing.json
//
// `npm run build` runs this automatically when RM_CATALOG_SOURCE=supabase
// (scripts/check-build-inputs.mjs). It is also the extraction path: the two
// files it writes are the complete catalog in a portable form.
//
//   npx tsx scripts/catalog-pull.mts [--out <dir>] [--check]
//     --out    write somewhere other than app/data (e.g. an export folder)
//     --check  do not write; exit 1 if the local files differ from the database

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, Rest } from "./lib/supabase-rest";
import { TABLES, META_KEY_BOOK, rowToProduct, rowToRule, assembleBook, type ProductRow, type RuleRow, type BookHeader } from "../app/lib/catalog-sync";

const ROOT = join(import.meta.dirname, "..");
loadEnv(ROOT);
const args = process.argv.slice(2);
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "app", "data");
const check = args.includes("--check");

const rest = new Rest();
const t0 = Date.now();
const [productRows, ruleRows, metaRows] = await Promise.all([
  rest.all<ProductRow>(TABLES.products, "position.asc"),
  rest.all<RuleRow>(TABLES.rules, "id.asc"),
  rest.all<{ key: string; value: BookHeader }>(TABLES.meta, "key.asc"),
]);
if (!productRows.length) {
  console.error("catalog-pull: rockwell_products is empty — run scripts/catalog-push.mts first.");
  process.exit(1);
}
const header = metaRows.find((m) => m.key === META_KEY_BOOK)?.value;
if (!header) {
  console.error("catalog-pull: rockwell_catalog_meta has no launch-pricing header — run scripts/catalog-push.mts first.");
  process.exit(1);
}

const products = productRows.map(rowToProduct);
const book = assembleBook(header, ruleRows.map(rowToRule));

const productsJson = JSON.stringify(products, null, 2) + "\n";
const bookJson = JSON.stringify(book, null, 2) + "\n";

const productsPath = join(outDir, "products.json");
const bookPath = join(outDir, "launch-pricing.json");

if (check) {
  // Compare values, not key order: the database round-trip may reorder keys.
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v;
  const same = (path: string, next: string) =>
    existsSync(path) && JSON.stringify(canon(JSON.parse(readFileSync(path, "utf-8")))) === JSON.stringify(canon(JSON.parse(next)));
  const okP = same(productsPath, productsJson);
  const okB = same(bookPath, bookJson);
  console.log(`catalog-pull --check: products ${okP ? "in sync" : "DIFFER"}, rule book ${okB ? "in sync" : "DIFFER"}`);
  process.exit(okP && okB ? 0 : 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(productsPath, productsJson, "utf-8");
writeFileSync(bookPath, bookJson, "utf-8");
console.log(`catalog-pull: ${products.length} products, ${ruleRows.length} rules, book v${book.version} → ${outDir} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
