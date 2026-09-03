// Live pricing proof-of-concept over 10 catalog products.
//
//   node scripts/price-test-10.mts            # live spot
//   node scripts/price-test-10.mts --offline  # fixed marks, no network
//
// Credentials are read from ../citadel-website/.env.local (METALS_API_KEY).
// The key is never printed. Reads the catalog; writes nothing.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { quoteProduct, type SpotPrices } from "../app/lib/pricing/quote";
import { PAYMENT_RAILS } from "../app/lib/pricing/rules";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OFFLINE = process.argv.includes("--offline");

// --- credentials -------------------------------------------------------------

function metalsApiKey(): string | null {
  for (const p of [
    join(ROOT, "..", "citadel-website", ".env.local"),
    join(ROOT, ".env.local"),
  ]) {
    try {
      const m = readFileSync(p, "utf8").match(/^METALS_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* try next */ }
  }
  return null;
}

// --- spot feed ---------------------------------------------------------------

const SANE = (metal: string, v: number) =>
  Number.isFinite(v) && v > 0 &&
  ({ gold: [500, 30000], silver: [5, 500], platinum: [200, 10000], palladium: [200, 10000] } as Record<string, number[]>)[metal]
    .every((b, i) => (i === 0 ? v >= b : v <= b));

async function fromMetalsApi(key: string): Promise<{ prices: SpotPrices; source: string } | null> {
  try {
    const url = `https://metals-api.com/api/latest?access_key=${key}&base=USD&symbols=XAU,XAG,XPT,XPD`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data: any = await res.json();
    if (!data?.success || !data?.rates) {
      console.log(`  metals-api declined: ${data?.error?.info ?? data?.error?.type ?? "unknown"}`);
      return null;
    }
    // Rates are quoted per USD, so invert to get USD per troy ounce.
    const inv = (r: number) => (r > 0 && r < 1 ? 1 / r : r);
    const prices: SpotPrices = {
      gold: inv(data.rates.XAU), silver: inv(data.rates.XAG),
      platinum: inv(data.rates.XPT), palladium: inv(data.rates.XPD),
    };
    if (!Object.entries(prices).every(([m, v]) => SANE(m, v))) {
      console.log("  metals-api returned values outside sane bounds; ignoring");
      return null;
    }
    return { prices, source: "metals-api.com (keyed)" };
  } catch (e) {
    console.log(`  metals-api unreachable: ${(e as Error).message}`);
    return null;
  }
}

async function fromGoldApi(): Promise<{ prices: SpotPrices; source: string } | null> {
  try {
    const syms = { gold: "XAU", silver: "XAG", platinum: "XPT", palladium: "XPD" };
    const out: any = {};
    for (const [metal, sym] of Object.entries(syms)) {
      const r = await fetch(`https://api.gold-api.com/price/${sym}`, { signal: AbortSignal.timeout(12000) });
      out[metal] = (await r.json())?.price;
    }
    if (!Object.entries(out).every(([m, v]) => SANE(m, v as number))) return null;
    return { prices: out as SpotPrices, source: "gold-api.com (free tier)" };
  } catch (e) {
    console.log(`  gold-api unreachable: ${(e as Error).message}`);
    return null;
  }
}

// Last-known marks, used only with --offline or a total feed outage.
const FALLBACK: SpotPrices = { gold: 4650, silver: 73, platinum: 1990, palladium: 1505 };

async function getSpot() {
  if (OFFLINE) return { prices: FALLBACK, source: "offline reference marks", live: false };

  const key = metalsApiKey();
  console.log(`Spot feed:\n  METALS_API_KEY from ../citadel-website: ${key ? "found" : "NOT FOUND"}`);

  const viaKey = key ? await fromMetalsApi(key) : null;
  const chosen = viaKey ?? (await fromGoldApi());
  if (!chosen) {
    console.log("  all feeds failed -> using reference marks\n");
    return { prices: FALLBACK, source: "reference marks (all feeds failed)", live: false };
  }
  console.log(`  source: ${chosen.source}\n`);
  return { ...chosen, live: true };
}

// --- product selection -------------------------------------------------------

// Ten deliberately chosen records: seven that should price cleanly across all
// four spot metals, plus three that must FAIL so the failure modes are visible.
const SELECTION: { label: string; match: (p: any) => boolean }[] = [
  // --- should price dynamically off spot ---
  { label: "Bullion · 1 oz silver",      match: (p) => p.sku === "RM-AG-CML-1OZ-RANDOM" && p.title.includes("BU") },
  { label: "Bullion · 1 oz gold",        match: (p) => p.sku === "RM-AU-AGE-1OZ-2026" && p.title.includes("1 oz") },
  { label: "Bullion · kilo gold bar",    match: (p) => p.sku === "RM-AU-BAR-1KG-VARIED" },
  { label: "Bullion · 100 oz silver bar",match: (p) => p.sku === "RM-AG-JM-100OZ-BAR" },

  // --- collector premium, metal leg still floats ---
  { label: "Semi-numismatic · MS-70 modern", match: (p) => p.title.startsWith("2026-W 1 oz Burnished Gold Eagle Dual Date MS-70") },
  { label: "Semi-numismatic · proof",        match: (p) => p.title === "1 oz Proof American Gold Eagle Coin" },

  // --- genuinely rare: spot must NOT drive the price ---
  { label: "TRUE numismatic · 1909-S MS-65", match: (p) => p.title.startsWith("1909-S $10 Indian Gold Eagle MS-65") },
  { label: "TRUE numismatic · 1857 Liberty", match: (p) => p.title === "1857 $10 Liberty Gold Eagle Coin" },

  // --- the data-quality landmine ---
  { label: "Pre-33 Double Eagle @ $0.99",    match: (p) => p.title === "1904 $20 Liberty Gold Double Eagle Coin" && p.price === 0.99 },
  { label: "90% junk silver bag",            match: (p) => p.sku === "RM-AG-MERCURY-DIME-100FACE" },
];

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";

async function main() {
  const spot = await getSpot();
  const catalog: any[] = JSON.parse(readFileSync(join(ROOT, "app/data/products.json"), "utf8"));

  console.log("Spot used (USD / troy oz):");
  for (const [m, v] of Object.entries(spot.prices)) console.log(`  ${m.padEnd(10)} ${money(v as number)}`);
  console.log(`  live: ${spot.live}\n`);
  console.log("=".repeat(100));

  let priced = 0;
  const failures: string[] = [];

  for (const [i, sel] of SELECTION.entries()) {
    const p = catalog.find(sel.match);
    console.log(`\n[${String(i + 1).padStart(2)}] ${sel.label}`);
    if (!p) { console.log("     (no matching product found)"); continue; }

    console.log(`     ${p.title.slice(0, 78)}`);
    console.log(`     sku=${p.sku}  metal=${p.metal}  purity=${p.purity || "-"}  metalContent=${JSON.stringify(p.metalContent)}`);

    const res = quoteProduct(p, spot.prices, 1);
    if (!res.ok) {
      console.log(`     >> NOT AUTO-PRICED: ${res.reason}`);
      if (res.classification) {
        console.log(`        classified ${res.classification.type} (${res.classification.reasons.join("; ")})`);
      }
      console.log(`        falls back to desk-set price; static value is ${p.price === null ? "null" : money(p.price)}`);
      failures.push(`${sel.label} -> ${res.reason}`);
      continue;
    }
    priced++;

    const q = res.quote;
    console.log(`     MODEL       : ${q.pricingType}  (${q.classification.reasons.join("; ")})`);
    console.log(`     fine weight : ${q.fineOz} oz  [${q.weight.source}, ${q.weight.confidence} confidence]`);
    console.log(`     rule        : ${q.rule.id} (${pct(q.rule.pctPremium)} premium, min ${money(q.rule.minDollarPremium)})`);
    console.log(`     melt        : ${money(q.spotUsed)} x ${q.fineOz} = ${money(q.meltValue)}`);
    console.log(`     premium     : ${money(q.premiumUsd)} (${pct(q.premiumPctOfMelt)})${q.premiumFloored ? "  [dollar floor bound]" : ""}`);
    console.log(`     LIVE PRICE  : ${money(q.cashPrice)}`);
    console.log(`       rails     : ${(Object.keys(PAYMENT_RAILS) as (keyof typeof PAYMENT_RAILS)[])
      .map((r) => `${PAYMENT_RAILS[r].label} ${money(q.railPrices[r])}`).join("   ")}`);
    console.log(`     margin floor: ${q.marginFloorApplied === null ? "NOT ENFORCEABLE (no cost basis in catalog)" : money(q.marginFloorApplied)}`);

    if (q.staticPrice !== null) {
      const flag = Math.abs(q.staticImpliedPremiumPct!) > 0.6 ? "   <-- implausible as bullion" : "";
      console.log(`     static price: ${money(q.staticPrice)}  (delta ${money(q.staticVsLiveDelta!)}), ` +
                  `implies ${pct(q.staticImpliedPremiumPct!)} over today's melt${flag}`);
    } else {
      console.log(`     static price: null`);
    }
    if (q.meltFloorBinding) console.log(`     !! MELT FLOOR IS BINDING — metal has overtaken the collector ask`);
    for (const w of q.warnings) console.log(`     warn        : ${w}`);
  }

  console.log("\n" + "=".repeat(100));
  console.log(`Priced ${priced}/10. Not priceable: ${failures.length}`);
  for (const f of failures) console.log(`  - ${f}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
