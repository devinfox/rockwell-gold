#!/usr/bin/env npx tsx
// Deterministic repairs to app/data/launch-pricing.json (audit: Medium —
// "134 rules flagged for review, 51 misclassified collectibles, product 497
// metal content wrong").
//
//   1. Fine-weight corrections for products whose catalog metalContent is
//      wrong. The premium is re-derived from the original competitor ask at
//      the spot mark it was observed against, so the customer price is
//      unchanged while the metal leg now tracks spot correctly.
//   2. Dated (older-year) coins classed BULLION_SPOT with a premium above 60%
//      of melt are re-classed SEMI_NUMISMATIC: the collector leg is anchored in
//      dollars and no longer inflates with every rally. Fractional coins and
//      small bars keep BULLION_SPOT — their high percentage premium is real
//      minting cost, and it is published in dollars.
//   3. Every touched rule is flagged needsReview with a reason so the desk can
//      confirm. Repairs are recorded in the book under `repairs`.
//
// Idempotent: re-running makes no further changes.
//
//   npx tsx scripts/repair-launch-pricing.mts [--dry-run]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LaunchRuleBook } from "../app/lib/pricing/launch-rules";

const ROOT = join(import.meta.dirname, "..");
const BOOK = join(ROOT, "app", "data", "launch-pricing.json");
const PRODUCTS = join(ROOT, "app", "data", "products.json");
const dry = process.argv.includes("--dry-run");

type Product = { id: string; title: string; metal: string; year: number | null; metalContent?: string };

/** Known-bad catalog weights: id → true fine troy ounces. */
const WEIGHT_FIXES: Record<string, { fineOz: number; why: string }> = {
  // 1/25 oz Vienna Philharmonic is 1.2442 g = 0.04 troy oz; the feed carried 0.7785 g.
  "497": { fineOz: 0.04, why: "1/25 oz Philharmonic is 0.04 troy oz (1.2442 g); catalog had 0.025" },
};

const THIS_YEAR = new Date().getUTCFullYear();
const COLLECTOR_AGE_YEARS = 3;
const HIGH_PREMIUM = 0.6;

const book = JSON.parse(readFileSync(BOOK, "utf-8")) as LaunchRuleBook & { repairs?: unknown[] };
const products = new Map((JSON.parse(readFileSync(PRODUCTS, "utf-8")) as Product[]).map((p) => [p.id, p]));
const spot = book.spotReference as unknown as Record<string, number>;
const round2 = (n: number) => Math.round(n * 100) / 100;

const repairs: { id: string; kind: string; before: unknown; after: unknown; why: string }[] = [];

for (const [id, fix] of Object.entries(WEIGHT_FIXES)) {
  const r = book.rules[id];
  if (!r || Math.abs(r.fineOz - fix.fineOz) < 1e-6) continue;
  const before = { fineOz: r.fineOz, premiumUsd: r.premiumUsd, premiumPct: r.premiumPct };
  const ask = r.calibration.competitorPriceUsd;
  const spotObs = r.calibration.spotAtObservation;
  r.fineOz = fix.fineOz;
  r.weightSource = "troy-oz";
  r.weightConfidence = "high";
  if (typeof ask === "number" && typeof spotObs === "number" && ask > 0) {
    const melt = spotObs * fix.fineOz;
    r.premiumUsd = round2(Math.max(r.minPremiumUsd, ask - melt));
    r.premiumPct = melt > 0 ? round2((r.premiumUsd / melt) * 1e4) / 1e4 : r.premiumPct;
  }
  r.needsReview = true;
  r.reviewReasons = Array.from(new Set([...(r.reviewReasons ?? []), `weight corrected: ${fix.why}`]));
  repairs.push({ id, kind: "weight", before, after: { fineOz: r.fineOz, premiumUsd: r.premiumUsd, premiumPct: r.premiumPct }, why: fix.why });
}

for (const [id, r] of Object.entries(book.rules)) {
  if (r.pricingType !== "BULLION_SPOT" || !r.live) continue;
  const p = products.get(id);
  if (!p) continue;
  const yearMatch = p.year ?? (p.title.match(/\b(18|19|20)\d{2}\b/)?.[0] ? Number(p.title.match(/\b(18|19|20)\d{2}\b/)![0]) : null);
  if (yearMatch === null || THIS_YEAR - yearMatch < COLLECTOR_AGE_YEARS) continue;
  const melt = (spot[p.metal] ?? 0) * r.fineOz;
  if (!(melt > 0)) continue;
  const premium = r.premiumMode === "usd" ? r.premiumUsd : melt * r.premiumPct;
  if (premium / melt <= HIGH_PREMIUM) continue;

  const before = { pricingType: r.pricingType, premiumMode: r.premiumMode, premiumUsd: r.premiumUsd, live: r.live };
  r.pricingType = "SEMI_NUMISMATIC";
  r.collectiblePremiumUsd = round2(premium);
  r.needsReview = true;
  // A collector premium can only come from an observed ask. One inherited from
  // a family median or a metal default is not evidence of collector value, so
  // such a piece is quote-only until the desk sets its ask.
  const observed = r.calibration.source === "apmex-observed" || r.calibration.source === "jm-observed";
  if (!observed) r.live = false;
  r.reviewReasons = Array.from(new Set([
    ...(r.reviewReasons ?? []),
    `re-classed SEMI_NUMISMATIC: ${yearMatch} issue with ${Math.round((premium / melt) * 100)}% premium over melt — collector leg fixed in dollars`,
    ...(observed ? [] : ["collector premium not observed (family/metal inferred) — quote-only until the desk sets an ask"]),
  ]));
  repairs.push({ id, kind: observed ? "reclass" : "reclass+hold", before, after: { pricingType: r.pricingType, collectiblePremiumUsd: r.collectiblePremiumUsd, live: r.live }, why: `${p.title}` });
}

if (repairs.length === 0) {
  console.log("launch-pricing.json: nothing to repair (already applied).");
  process.exit(0);
}

book.repairs = [...(book.repairs ?? []), { appliedAt: new Date().toISOString(), script: "scripts/repair-launch-pricing.mts", changes: repairs }];
book.version = (book.version ?? 0) + 1;

for (const c of repairs) console.log(`${c.kind.padEnd(8)} ${c.id.padEnd(5)} ${c.why}`);
console.log(`\n${repairs.length} repair(s)${dry ? " (dry run — not written)" : ""}`);
if (!dry) writeFileSync(BOOK, JSON.stringify(book, null, 2) + "\n", "utf-8");
