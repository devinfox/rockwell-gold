// Verifies the launch rule book against competitor asks.
//
//   node --import ./scripts/ts-extension-hook.mjs scripts/verify-launch-pricing.mts
//
// Every APMEX ask (captured 2026-08-17..20) and every title-verified JM Bullion
// ask (2026-08-25) is re-floated onto today's spot, and each live price is
// measured against that band. Writes data/launch_pricing_comp_check.json.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteProduct } from "../app/lib/pricing/quote";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(ROOT + "/" + p, "utf8"));
const catalog: any[] = read("app/data/products.json");
const book = read("app/data/launch-pricing.json");
const apmex = read("data/apmex_observations.json");
const spotWin: any[] = read("data/spot_observations_aug2026.json");
const jmObs = read("data/jm_observations.json");
const TODAY: Record<string, number> = { gold: 4492.4, silver: 67.19, platinum: 1835, palladium: 1447 }; // metal_prices latest row
const spotAt = (iso: string) => { let b = spotWin[0]; for (const r of spotWin) if (r.fetched_at <= iso) b = r; return b; };
const apmexIdOf = (u: string) => (u.match(/\/product\/(\d+)\//) ?? [])[1];

const rows: any[] = [];
for (const p of catalog) {
  const r = book.rules[String(p.id)]; if (!r.live) continue;
  const q = quoteProduct({ ...p, launchRule: r }, TODAY as unknown as import("../app/lib/pricing/quote").SpotPrices, 1); if (!q.ok) continue;
  const live = q.quote.cashPrice; const metal = String(p.metal);
  const o = apmex[String(p.apmexReferenceUrl ?? "").replace(/\/$/, "").toLowerCase()];
  let apmexAdj: number | null = null, jmAdj: number | null = null;
  if (o?.price) { const s = spotAt(o.scrapedAt) as Record<string, number>; const adj = o.price + (TODAY[metal] - s[metal]) * r.fineOz; apmexAdj = adj < TODAY[metal] * r.fineOz * 0.9 ? null : adj; }
  const j = jmObs.byApmexId[apmexIdOf(p.apmexReferenceUrl ?? "")];
  const tok = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9/. ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["coin","the","and","with","oz"].includes(w)));
  const weightTok = (t: string) => (t.toLowerCase().match(/(\d+\/\d+|\d+(?:\.\d+)?)\s*(?:oz|gram|g\b|kilo)/) ?? [])[1];
  const jmMatches = (() => { if (!j) return false; const a = tok(p.title), b = tok(j.title); let inter = 0; for (const w of a) if (b.has(w)) inter++; const jac = inter / (a.size + b.size - inter); return jac >= 0.45 && weightTok(p.title) === weightTok(j.title) && (p.metal ? j.title.toLowerCase().includes(p.metal) : true); })();
  if (j?.price && jmMatches) { const adj = j.price + (TODAY[metal] - (jmObs.spot as Record<string, number>)[metal]) * r.fineOz; jmAdj = adj < TODAY[metal] * r.fineOz * 0.9 ? null : adj; }
  const comps = [apmexAdj, jmAdj].filter((x): x is number => x !== null);
  const lo = comps.length ? Math.min(...comps) : null, hi = comps.length ? Math.max(...comps) : null;
  const dev = apmexAdj ? live / apmexAdj - 1 : jmAdj ? live / jmAdj - 1 : null;
  const inBand = lo !== null ? live >= lo * 0.97 && live <= hi! * 1.03 : null;
  rows.push({ id: p.id, title: p.title, type: r.pricingType, calib: r.calibration.source, live, apmexAdj, jmAdj, dev, inBand });
}
const withComp = rows.filter((x) => x.dev !== null);
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`live-priced: ${rows.length}   with a competitor comp: ${withComp.length}   (APMEX ${rows.filter(x=>x.apmexAdj).length}, JM ${rows.filter(x=>x.jmAdj).length}, both ${rows.filter(x=>x.apmexAdj&&x.jmAdj).length})`);
for (const b of [0.01, 0.03, 0.05, 0.10]) console.log(`  within ±${b*100}% of APMEX/JM comp: ${withComp.filter(x=>Math.abs(x.dev)<=b).length}  ${pct(withComp.filter(x=>Math.abs(x.dev)<=b).length, withComp.length)}`);
console.log(`  inside the APMEX↔JM band (±3% tolerance): ${withComp.filter(x=>x.inBand).length} of ${withComp.length}`);
console.log(`  above the highest comp by >5%: ${withComp.filter(x=>x.dev>0.05).length}   below the lowest comp by >5%: ${withComp.filter(x=>x.dev<-0.05).length}`);
console.log("\nby calibration source (median |dev|, n):");
for (const s of ["apmex-observed","jm-observed","family-median","metal-default"]) { const xs = withComp.filter(x=>x.calib===s).map(x=>Math.abs(x.dev)).sort((a,b)=>a-b); console.log(`  ${s.padEnd(16)} n=${xs.length}  median ${xs.length? (100*xs[Math.floor(xs.length/2)]).toFixed(2):"-"}%  p90 ${xs.length?(100*xs[Math.floor(xs.length*0.9)]).toFixed(2):"-"}%`); }
console.log("\ninherited rules by class (median |dev| vs a comp, n):");
for (const t of ["BULLION_SPOT","SEMI_NUMISMATIC"]) { const xs = withComp.filter(x=>x.type===t && (x.calib==="family-median"||x.calib==="metal-default")).map(x=>Math.abs(x.dev)).sort((a,b)=>a-b); console.log(`  ${t.padEnd(16)} n=${xs.length}  median ${xs.length?(100*xs[Math.floor(xs.length/2)]).toFixed(1):"-"}%  p90 ${xs.length?(100*xs[Math.floor(xs.length*0.9)]).toFixed(1):"-"}%  within 10%: ${xs.filter(v=>v<=0.10).length}`); }
console.log("inherited rules with NO comp, by class:", Object.fromEntries(["BULLION_SPOT","SEMI_NUMISMATIC"].map(t=>[t, rows.filter(x=>x.type===t && x.dev===null).length])));
console.log("\nno comp at all (priced from family/metal default only):", rows.filter(x=>x.dev===null).length);
console.log("\nJM vs APMEX spread itself (both observed): median", (()=>{const d=rows.filter(x=>x.apmexAdj&&x.jmAdj).map(x=>Math.abs(x.jmAdj/x.apmexAdj-1)).sort((a,b)=>a-b); return (100*d[Math.floor(d.length/2)]).toFixed(1)+"%";})());
console.log("\nOUTLIERS (|dev| > 10%):");
for (const x of withComp.filter(x=>Math.abs(x.dev)>0.10).sort((a,b)=>Math.abs(b.dev)-Math.abs(a.dev)).slice(0,25)) console.log(`  ${(100*x.dev).toFixed(1).padStart(7)}%  live $${x.live.toFixed(2).padStart(9)}  apmex ${x.apmexAdj?("$"+x.apmexAdj.toFixed(2)):"-"}  jm ${x.jmAdj?("$"+x.jmAdj.toFixed(2)):"-"}  [${x.calib}] ${x.title.slice(0,55)}`);
writeFileSync(ROOT + "/data/launch_pricing_comp_check.json", JSON.stringify(rows, null, 1));
