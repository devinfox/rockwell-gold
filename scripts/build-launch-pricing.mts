// Builds the launch catalog + competitor-calibrated pricing rules.
//
//   node --import ./scripts/ts-extension-hook.mjs scripts/build-launch-pricing.mts
//
// Inputs
//   data/launch_top_1000.json            the launch set (scripts/select_launch_top_1000.py)
//   data/apmex_observations.json         APMEX ask + scrape timestamp + product family per URL
//   data/spot_observations_aug2026.json  metal_prices rows for the scrape window (shared Supabase)
//
// Outputs
//   app/data/products.json               the live catalog = the launch set only
//   app/data/launch-pricing.json         one LaunchRule per product (see app/lib/pricing/launch-rules.ts)
//
// Method (from the APMEX / JM Bullion deep dives):
//   bullion            premium = competitor ask − (spot at observation × fine oz), re-floated on live spot
//   semi-numismatic    collector leg in dollars = ask − melt at observation; metal leg floats
//   true numismatic    fixed merchant ask = competitor ask; melt is only a floor; no ask → not priced
// Bullion without a usable observation inherits the median premium of its product family
// (backtest: 3.8% median price error), then a metal default, and is flagged for desk review.
// Semi-numismatics and true numismatics without an observation are NOT auto-priced.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../app/lib/pricing/classify";
import { resolveFineOz } from "../app/lib/pricing/fine-weight";
import { hasSpot } from "../app/lib/pricing/rules";
import type { LaunchRule, LaunchRuleBook, LivePricingType } from "../app/lib/pricing/launch-rules";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

type Product = Record<string, any>;
type Obs = { price: number | null; scrapedAt: string; family: string; availability: string; reviews: string };
type SpotRow = { gold: number; silver: number; platinum: number; palladium: number; fetched_at: string };

const launch: Product[] = read("data/launch_top_1000.json");
// JM Bullion asks (captured 2026-08-25) keyed by APMEX product id. The research
// CSV matched JM listings to APMEX products by fuzzy title and got many wrong,
// so a JM row only counts when its own title agrees with ours on weight, metal
// and most significant words.
type JmObs = { spot: { gold: number; silver: number; platinum: number; palladium: number; fetched_at: string }; byApmexId: Record<string, { price: number | null; avail: string; title: string }> };
const jmObs: JmObs = read("data/jm_observations.json");
const apmexIdOf = (u: string) => (u.match(/\/product\/(\d+)\//) ?? [])[1];
const tok = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9/. ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["coin", "the", "and", "with", "oz"].includes(w)));
const weightTok = (t: string) => (t.toLowerCase().match(/(\d+\/\d+|\d+(?:\.\d+)?)\s*(?:oz|gram|g\b|kilo)/) ?? [])[1];
function jmMatch(p: Product): { price: number; title: string } | null {
  const j = jmObs.byApmexId[apmexIdOf(String(p.apmexReferenceUrl ?? ""))];
  if (!j?.price || j.price <= 0) return null;
  const a = tok(p.title), b = tok(j.title);
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  const jac = inter / (a.size + b.size - inter);
  const metal = String(p.metal ?? "").toLowerCase();
  if (jac >= 0.45 && weightTok(p.title) === weightTok(j.title) && (!metal || j.title.toLowerCase().includes(metal))) return { price: j.price, title: j.title };
  return null;
}
const obs: Record<string, Obs> = read("data/apmex_observations.json");
const spotRows: SpotRow[] = read("data/spot_observations_aug2026.json").sort(
  (a: SpotRow, b: SpotRow) => Date.parse(a.fetched_at) - Date.parse(b.fetched_at),
);

/** Spot mark in force when a competitor ask was captured: latest row at or before the timestamp. */
function spotAt(iso: string): { row: SpotRow; asOf: string } {
  const t = Date.parse(iso);
  let best = spotRows[0];
  for (const r of spotRows) if (Date.parse(r.fetched_at) <= t) best = r;
  return { row: best, asOf: best.fetched_at };
}

const METAL_DEFAULT: Record<string, { mode: "usd" | "pct"; pct: number; usdPerOz: number; min: number }> = {
  gold:      { mode: "pct", pct: 0.045, usdPerOz: 0,   min: 40 },
  silver:    { mode: "usd", pct: 0.10,  usdPerOz: 6.5, min: 2.5 },
  platinum:  { mode: "pct", pct: 0.08,  usdPerOz: 0,   min: 45 },
  palladium: { mode: "pct", pct: 0.10,  usdPerOz: 0,   min: 50 },
};

// Silver and small units are quoted "$ over spot"; gold/platinum scale with melt.
const modeFor = (metal: string, fineOz: number): "usd" | "pct" =>
  metal === "silver" || fineOz < 0.25 ? "usd" : "pct";

/**
 * Is an observed premium plausible for the class? Small units carry large
 * percentage premiums but small dollar ones (a 1 g silver bar is ~$8 over $2
 * of metal), so both a % ceiling and a $ ceiling are accepted.
 */
function plausibility(type: LivePricingType, premiumUsd: number, premiumPct: number): "ok" | "low" | "high" {
  if (premiumPct < -0.02) return "low";
  if (type === "TRUE_NUMISMATIC") return "ok";
  if (type === "BULLION_SPOT") {
    // Ordinary bullion sits under +60%. Vintage bars, small fractionals and
    // CombiBars legitimately run 100–250% over melt but only tens of dollars;
    // lot/tube prices and mis-dated rarities are thousands of dollars over.
    if (premiumPct <= 0.6) return "ok";
    if (premiumPct <= 2.5 && premiumUsd <= 300) return "ok";
    if (premiumPct <= 4 && premiumUsd <= 60) return "ok";
    return "high";
  }
  return premiumPct <= 6 || premiumUsd <= 300 ? "ok" : "high";
}

const familyKey = (fam: string | undefined, metal: string, fineOz: number, type: LivePricingType) => {
  const parts = (fam ?? "").split(" | ");
  const bucket = fineOz >= 50 ? "100oz" : fineOz >= 5 ? "5-50oz" : fineOz >= 0.9 ? "1oz" : fineOz >= 0.2 ? "fractional" : "tiny";
  return `${metal}|${parts[4] ?? "?"}|${bucket}|${type}`;
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// ---- pass 1: per-product observation ---------------------------------------

type Draft = {
  p: Product; type: LivePricingType | "UNCLASSIFIED"; fineOz: number | null; wsrc: any; wconf: any;
  family: string; observed: null | { premiumUsd: number; premiumPct: number; melt: number; ask: number; spot: number; asOf: string; dealer: "apmex" | "jm" };
  /** An observation existed but was rejected on the HIGH side: never auto-price from a default. */
  rejectedHigh: boolean;
  reasons: string[];
};
const drafts: Draft[] = [];

for (const p of launch) {
  const metal = String(p.metal ?? "").toLowerCase();
  const c = classify(p);
  const w = resolveFineOz(p.metalContent, p.title);
  const o = obs[String(p.apmexReferenceUrl ?? "").replace(/\/$/, "").toLowerCase()];
  const reasons: string[] = [];
  const type = c.type;
  const fam = familyKey(o?.family, metal, w?.fineOz ?? 0, type === "UNCLASSIFIED" ? "BULLION_SPOT" : type);
  let observed: Draft["observed"] = null;
  let rejectedHigh = false;

  if (w && hasSpot(metal) && o?.price && o.price > 0 && type !== "UNCLASSIFIED") {
    const { row, asOf } = spotAt(o.scrapedAt);
    const spot = row[metal as keyof SpotRow] as number;
    const melt = spot * w.fineOz;
    const premiumUsd = o.price - melt;
    const premiumPct = premiumUsd / melt;
    const verdict = plausibility(type, premiumUsd, premiumPct);
    if (verdict === "ok") observed = { premiumUsd, premiumPct, melt, ask: o.price, spot, asOf, dealer: "apmex" };
    else {
      reasons.push(`observed ask ${o.price} implies ${round(premiumPct * 100, 1)}% over melt — outside plausible range (${verdict})`);
      // An ask far ABOVE melt means the piece carries value the metal leg
      // cannot see (a set with a gold medal, a rarity mis-dated as modern).
      // Pricing it from a family default would sell it for a fraction of its
      // value — the asymmetric failure the deep dive warns about.
      if (verdict === "high") rejectedHigh = true;
    }
  } else if (!o?.price) reasons.push("no APMEX ask observed");

  // Second source: a title-verified JM Bullion ask, only when APMEX gave nothing usable.
  if (!observed && !rejectedHigh && w && hasSpot(metal) && type !== "UNCLASSIFIED") {
    const jm = jmMatch(p);
    if (jm) {
      const spot = jmObs.spot[metal as keyof JmObs["spot"]] as number;
      const melt = spot * w.fineOz;
      const premiumUsd = jm.price - melt;
      const premiumPct = premiumUsd / melt;
      const verdict = plausibility(type, premiumUsd, premiumPct);
      if (verdict === "ok") { observed = { premiumUsd, premiumPct, melt, ask: jm.price, spot, asOf: jmObs.spot.fetched_at, dealer: "jm" }; reasons.push(`calibrated from JM Bullion listing "${jm.title}"`); }
      else if (verdict === "high") { rejectedHigh = true; reasons.push(`JM ask ${jm.price} implies ${round(premiumPct * 100, 1)}% over melt — outside plausible range (high)`); }
    }
  }
  if (!w) reasons.push("no fine weight");
  if (!hasSpot(metal)) reasons.push(`no spot for metal '${metal}'`);
  if (type === "UNCLASSIFIED") reasons.push("unclassified: " + c.reasons.join(", "));
  drafts.push({ p, type, fineOz: w?.fineOz ?? null, wsrc: w?.source, wconf: w?.confidence, family: fam, observed, rejectedHigh, reasons });
}

// ---- pass 2: family medians from observed peers -----------------------------

const famUsd = new Map<string, number[]>();
const famPct = new Map<string, number[]>();
for (const d of drafts) {
  if (!d.observed) continue;
  (famUsd.get(d.family) ?? famUsd.set(d.family, []).get(d.family)!).push(d.observed.premiumUsd);
  (famPct.get(d.family) ?? famPct.set(d.family, []).get(d.family)!).push(d.observed.premiumPct);
}

// ---- pass 3: rules ------------------------------------------------------------

const rules: Record<string, LaunchRule> = {};
const stats = { byType: {} as Record<string, number>, bySource: {} as Record<string, number>, live: 0, review: 0, notLive: [] as string[] };
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

for (const d of drafts) {
  const p = d.p;
  const metal = String(p.metal ?? "").toLowerCase();
  const id = String(p.id);
  if (d.type === "UNCLASSIFIED" || d.fineOz == null || !hasSpot(metal)) {
    // Still emit a rule so the storefront knows it is deliberately not live.
    rules[id] = {
      id, sku: p.sku, pricingType: d.type === "UNCLASSIFIED" ? "TRUE_NUMISMATIC" : d.type,
      fineOz: d.fineOz ?? 0, weightSource: d.wsrc ?? "title", weightConfidence: d.wconf ?? "low",
      premiumMode: "pct", premiumUsd: 0, premiumPct: 0, minPremiumUsd: 0,
      calibration: { source: "none" }, confidence: "low", live: false, needsReview: true, reviewReasons: d.reasons,
    };
    bump(stats.byType, "NOT_LIVE"); bump(stats.bySource, "none"); stats.review++; stats.notLive.push(`${id} ${p.title}`);
    continue;
  }

  const def = METAL_DEFAULT[metal];
  const mode = modeFor(metal, d.fineOz);
  const peersUsd = famUsd.get(d.family) ?? [];
  const peersPct = famPct.get(d.family) ?? [];
  const reasons = [...d.reasons];
  let source: LaunchRule["calibration"]["source"];
  let premiumUsd: number, premiumPct: number;
  let confidence: LaunchRule["confidence"];
  let collectiblePremiumUsd: number | undefined;
  let merchantAskUsd: number | undefined;
  let live = true;

  if (d.observed) {
    source = d.observed.dealer === "jm" ? "jm-observed" : "apmex-observed"; premiumUsd = d.observed.premiumUsd; premiumPct = d.observed.premiumPct; confidence = "high";
  } else if (d.rejectedHigh) {
    source = "none"; premiumUsd = 0; premiumPct = 0; confidence = "low"; live = false;
    reasons.push("competitor ask far above metal value — needs a desk-set ask, not a default premium");
  } else if (d.type === "SEMI_NUMISMATIC") {
    // Backtest (2026-09-03): a family-median collector premium misses the
    // observed price by 11% at the median and 64% at p90. Not sellable
    // automatically — the desk sets the collector leg.
    source = "none"; premiumUsd = 0; premiumPct = 0; confidence = "low"; live = false;
    reasons.push("collector premium cannot be inferred from peers — desk must set collectiblePremiumUsd");
  } else if (peersUsd.length >= 2 && d.type !== "TRUE_NUMISMATIC") {
    source = "family-median"; premiumUsd = median(peersUsd); premiumPct = median(peersPct); confidence = "medium";
    reasons.push(`premium inherited from ${peersUsd.length} family peers (${d.family})`);
  } else if (d.type !== "TRUE_NUMISMATIC") {
    source = "metal-default"; premiumPct = def.pct; premiumUsd = mode === "usd" ? Math.max(def.usdPerOz * d.fineOz, def.min) : 0; confidence = "low";
    reasons.push("metal-level default premium — desk should set");
  } else {
    source = "none"; premiumUsd = 0; premiumPct = 0; confidence = "low"; live = false;
    reasons.push("true numismatic with no observed ask — needs specialist ask before it can be sold");
  }

  if (d.type === "SEMI_NUMISMATIC") collectiblePremiumUsd = round(Math.max(premiumUsd, def.min));
  if (d.type === "TRUE_NUMISMATIC" && d.observed) merchantAskUsd = round(d.observed.ask);
  // Bullion floor: never below the metal minimum, and never below 0.75% of
  // melt at the reference spot — junk-silver bags were observed at or under
  // spot, and a $2.50 spread on a $4,700 bag is not a viable ask.
  const refSpot = spotRows[spotRows.length - 1][metal as keyof SpotRow] as number;
  const minPremiumUsd = round(Math.max(def.min, 0.0075 * refSpot * d.fineOz));

  const rule: LaunchRule = {
    id, sku: p.sku, pricingType: d.type,
    fineOz: d.fineOz, weightSource: d.wsrc, weightConfidence: d.wconf,
    premiumMode: mode,
    premiumUsd: round(Math.max(premiumUsd, 0)),
    premiumPct: round(Math.max(premiumPct, 0), 5),
    minPremiumUsd,
    ...(collectiblePremiumUsd !== undefined ? { collectiblePremiumUsd } : {}),
    ...(merchantAskUsd !== undefined ? { merchantAskUsd } : {}),
    calibration: {
      source,
      ...(d.observed ? { competitorPriceUsd: d.observed.ask, spotAtObservation: d.observed.spot, observedAt: d.observed.asOf } : {}),
      family: d.family, peers: peersUsd.length,
    },
    confidence,
    live,
    needsReview: !live || (source !== "apmex-observed" && source !== "jm-observed") || d.wconf !== "high",
    reviewReasons: reasons,
  };
  if (rule.weightConfidence !== "high") rule.reviewReasons.push(`fine weight parsed from ${rule.weightSource} (${rule.weightConfidence} confidence)`);
  rules[id] = rule;
  bump(stats.byType, rule.pricingType); bump(stats.bySource, source);
  if (rule.live) stats.live++; else stats.notLive.push(`${id} ${p.title}`);
  if (rule.needsReview) stats.review++;
}

// ---- write ---------------------------------------------------------------------

const latestSpot = spotRows[spotRows.length - 1];
const book: LaunchRuleBook = {
  version: 1,
  generatedAt: new Date().toISOString(),
  spotReference: { gold: latestSpot.gold, silver: latestSpot.silver, platinum: latestSpot.platinum, palladium: latestSpot.palladium, asOf: latestSpot.fetched_at },
  rules,
};
writeFileSync(join(ROOT, "app/data/launch-pricing.json"), JSON.stringify(book, null, 1));

const catalog = launch
  .slice()
  .sort((a, b) => (a.launchRank ?? 0) - (b.launchRank ?? 0))
  .map(({ launchScore: _s, ...p }) => p);
writeFileSync(join(ROOT, "app/data/products.json"), JSON.stringify(catalog, null, 1));

console.log(`launch catalog written: ${catalog.length} products -> app/data/products.json`);
console.log(`pricing rules written:  ${Object.keys(rules).length} -> app/data/launch-pricing.json`);
console.log("by pricing type:", stats.byType);
console.log("by calibration :", stats.bySource);
console.log(`live-priced: ${stats.live}   needs desk review: ${stats.review}   not live (enquire): ${stats.notLive.length}`);
for (const t of stats.notLive.slice(0, 40)) console.log("   not live:", t);
