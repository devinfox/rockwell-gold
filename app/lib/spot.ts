import "server-only";

// One source of truth for spot prices.
//
// Feed architecture mirrors citadel-website/lib/metals-cache.ts, and shares its
// data: both sites run on the same Supabase project, and citadel's scheduled
// cron (/api/cron/metals, every ~5h) writes the upstream mark into the
// `metal_prices` table. The storefront read path therefore never has to call
// an upstream vendor:
//
//   1. in-memory snapshot (60s)            — one read per server per minute
//   2. latest `metal_prices` row           — shared, written by the cron
//   3. upstream refresh, only if that row is older than REFRESH_AFTER_MS:
//        gold-api.com (free, keyless)  →  metals-api.com (METALS_API_KEY)
//      and the result is written back so both sites benefit
//   4. last-known snapshot, then the reference marks below (live=false)
//
// Everything downstream (tickers, PDP quotes, price locks, vault valuation)
// reads from getSpot(), so every surface shows the same mark.

export type MetalSymbol = "XAU" | "XAG" | "XPT" | "XPD";

export interface SpotQuote {
  prices: Record<MetalSymbol, number>;
  /** Session change as a fraction, e.g. 0.0042 */
  change: Record<MetalSymbol, number>;
  /** When the mark was observed upstream (not when it was served). */
  asOf: string;
  source: string;
  /** False when these are fallback marks rather than a market observation. */
  live: boolean;
  /** Seconds since the mark was observed. */
  ageSeconds: number;
  /** True when the mark is older than STALE_AFTER_MS; quotes are flagged indicative. */
  stale: boolean;
  /** True when so old that spot-linked quotes must not be issued at all. */
  hardStale: boolean;
}

// A bullion dealer's "live" mark must be minutes old, not hours (audit: Medium —
// a 4.4 h old mark was labelled live). The shared row is refreshed from the
// keyless upstream whenever it is older than REFRESH_AFTER_MS, so the whole
// fleet shares one upstream call per window; a mark older than STALE_AFTER_MS
// is shown as indicative, and spot-linked quotes stop entirely past HARD_STALE.
export const REFRESH_AFTER_MS = 15 * 60_000;
export const STALE_AFTER_MS = 60 * 60_000;
export const HARD_STALE_AFTER_MS = 36 * 3600_000;
const MEMORY_TTL_MS = 60_000;

/** Last-known reference marks. Used only when every feed is unavailable. */
const FALLBACK: Record<MetalSymbol, number> = {
  XAU: 4492.4,
  XAG: 67.19,
  XPT: 1835,
  XPD: 1447,
};

const ZERO_CHANGE: Record<MetalSymbol, number> = { XAU: 0, XAG: 0, XPT: 0, XPD: 0 };

/** Plausibility bounds, USD per troy oz. Anything outside is treated as a bad tick. */
const SANE: Record<MetalSymbol, [number, number]> = {
  XAU: [500, 30000],
  XAG: [5, 500],
  XPT: [200, 10000],
  XPD: [200, 10000],
};
const sane = (sym: MetalSymbol, v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= SANE[sym][0] && v <= SANE[sym][1];

type Snapshot = {
  prices: Record<MetalSymbol, number>;
  change: Record<MetalSymbol, number>;
  asOf: string;
  source: string;
  live: boolean;
};

let memory: Snapshot | null = null;
let memoryReadAt = 0;
let inflight: Promise<Snapshot> | null = null;

function finish(s: Snapshot): SpotQuote {
  const ageMs = Math.max(0, Date.now() - Date.parse(s.asOf));
  return {
    ...s,
    ageSeconds: Math.round(ageMs / 1000),
    stale: !s.live || ageMs > STALE_AFTER_MS,
    hardStale: !s.live || ageMs > HARD_STALE_AFTER_MS,
  };
}

const fallbackSnapshot = (): Snapshot => ({
  prices: { ...FALLBACK },
  change: { ...ZERO_CHANGE },
  asOf: new Date(0).toISOString(),
  source: "reference marks — no feed available",
  live: false,
});

// --- Supabase (shared `metal_prices` table) --------------------------------

function supabaseEnv() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, readKey: service || anon, writeKey: service };
}

type Row = {
  gold: number | string; silver: number | string; platinum: number | string; palladium: number | string;
  changes_percent?: Partial<Record<"gold" | "silver" | "platinum" | "palladium", number>>;
  source: string; fetched_at: string;
};

async function readLatestRow(): Promise<Snapshot | null> {
  const { url, readKey } = supabaseEnv();
  if (!url || !readKey) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/metal_prices?select=gold,silver,platinum,palladium,changes_percent,source,fetched_at&order=fetched_at.desc&limit=1`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` }, cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) throw new Error(`metal_prices read ${res.status}`);
    const rows = (await res.json()) as Row[];
    const r = rows[0];
    if (!r) return null;
    const prices: Record<MetalSymbol, number> = {
      XAU: Number(r.gold), XAG: Number(r.silver), XPT: Number(r.platinum), XPD: Number(r.palladium),
    };
    for (const k of Object.keys(prices) as MetalSymbol[]) if (!sane(k, prices[k])) return null;
    const cp = r.changes_percent ?? {};
    const change: Record<MetalSymbol, number> = {
      XAU: (cp.gold ?? 0) / 100, XAG: (cp.silver ?? 0) / 100, XPT: (cp.platinum ?? 0) / 100, XPD: (cp.palladium ?? 0) / 100,
    };
    return { prices, change, asOf: new Date(r.fetched_at).toISOString(), source: `metal_prices (${r.source})`, live: true };
  } catch (err) {
    console.error("[spot] metal_prices read failed:", err);
    return null;
  }
}

async function persistRow(s: Snapshot, source: string): Promise<void> {
  const { url, writeKey } = supabaseEnv();
  if (!url || !writeKey) return;
  try {
    await fetch(`${url}/rest/v1/metal_prices`, {
      method: "POST",
      headers: { apikey: writeKey, Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        gold: s.prices.XAU, silver: s.prices.XAG, platinum: s.prices.XPT, palladium: s.prices.XPD,
        changes_percent: { gold: s.change.XAU * 100, silver: s.change.XAG * 100, platinum: s.change.XPT * 100, palladium: s.change.XPD * 100 },
        source, fetched_at: s.asOf,
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.error("[spot] metal_prices write failed:", err);
  }
}

// --- Upstream vendors (only when the shared row is stale) ------------------

const SYMBOLS: MetalSymbol[] = ["XAU", "XAG", "XPT", "XPD"];

async function fromGoldApi(): Promise<Snapshot | null> {
  try {
    const out = {} as Record<MetalSymbol, number>;
    let newest = 0;
    await Promise.all(SYMBOLS.map(async (sym) => {
      const r = await fetch(`https://api.gold-api.com/price/${sym}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      const j = (await r.json()) as { price?: number; updatedAt?: string };
      out[sym] = Number(j.price);
      newest = Math.max(newest, Date.parse(j.updatedAt ?? "") || 0);
    }));
    if (!SYMBOLS.every((s) => sane(s, out[s]))) return null;
    return { prices: out, change: { ...ZERO_CHANGE }, asOf: new Date(newest || Date.now()).toISOString(), source: "gold-api", live: true };
  } catch (err) {
    console.error("[spot] gold-api unavailable:", err);
    return null;
  }
}

async function fromMetalsApi(): Promise<Snapshot | null> {
  const key = process.env.METALS_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://metals-api.com/api/latest?access_key=${key}&base=USD&symbols=XAU,XAG,XPT,XPD`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    const j = (await r.json()) as { success?: boolean; rates?: Record<string, number>; timestamp?: number };
    if (!j.success || !j.rates) return null;
    // Rates are quoted per USD; invert to USD per troy oz.
    const inv = (v: number) => (v > 0 && v < 1 ? 1 / v : v);
    const out = {} as Record<MetalSymbol, number>;
    for (const s of SYMBOLS) out[s] = inv(Number(j.rates[s]));
    if (!SYMBOLS.every((s) => sane(s, out[s]))) return null;
    return { prices: out, change: { ...ZERO_CHANGE }, asOf: new Date((j.timestamp ?? Date.now() / 1000) * 1000).toISOString(), source: "metals-api", live: true };
  } catch (err) {
    console.error("[spot] metals-api unavailable:", err);
    return null;
  }
}

async function refreshFromUpstream(previous: Snapshot | null): Promise<Snapshot | null> {
  const fresh = (await fromGoldApi()) ?? (await fromMetalsApi());
  if (!fresh) return null;
  // Carry the day-change over from the last cron row only while it is the same
  // session; a change figure from an older session is misleading, so zero it.
  if (previous?.live && Date.now() - Date.parse(previous.asOf) < 24 * 3600_000) {
    fresh.change = { ...previous.change };
  }
  // Another instance may have refreshed while we were fetching. If a newer row
  // now exists, adopt it instead of writing a duplicate (audit: Medium — N cold
  // instances produced N upstream calls and N rows).
  const latest = await readLatestRow();
  if (latest && Date.now() - Date.parse(latest.asOf) <= REFRESH_AFTER_MS) return latest;
  await persistRow(fresh, fresh.source);
  return fresh;
}

async function load(): Promise<Snapshot> {
  const row = await readLatestRow();
  const rowAge = row ? Date.now() - Date.parse(row.asOf) : Infinity;
  if (row && rowAge <= REFRESH_AFTER_MS) return row;

  const fresh = await refreshFromUpstream(row);
  if (fresh) return fresh;
  if (row) return row;            // stale but real; flagged by finish()
  if (memory) return memory;      // last-known
  return fallbackSnapshot();
}

/**
 * Current spot, memoised for 60s per server process. Never throws: a provider
 * outage degrades to the last-known mark rather than taking the storefront down.
 */
export async function getSpot(): Promise<SpotQuote> {
  const now = Date.now();
  if (memory && now - memoryReadAt < MEMORY_TTL_MS) return finish(memory);
  if (!inflight) {
    inflight = load()
      .then((s) => { memory = s; memoryReadAt = Date.now(); return s; })
      .catch((err) => { console.error("[spot] load failed:", err); return memory ?? fallbackSnapshot(); })
      .finally(() => { inflight = null; });
  }
  return finish(await inflight);
}

const METAL_TO_SYMBOL: Record<string, MetalSymbol> = {
  gold: "XAU",
  silver: "XAG",
  platinum: "XPT",
  palladium: "XPD",
};

export const symbolForMetal = (metal: string): MetalSymbol | null =>
  METAL_TO_SYMBOL[metal?.toLowerCase()] ?? null;

/** The engine's per-metal view of a quote. */
export const spotForEngine = (q: SpotQuote) => ({
  gold: q.prices.XAU, silver: q.prices.XAG, platinum: q.prices.XPT, palladium: q.prices.XPD,
});

/**
 * Metal value of a holding at spot: fine troy ounces × the spot mark.
 * Returns null for a metal with no quoted spot (copper and misc.), so callers
 * show "—" instead of inventing a number.
 */
export function meltValue(metal: string, fineOz: number, spot: SpotQuote): number | null {
  const sym = symbolForMetal(metal);
  if (!sym) return null;
  return spot.prices[sym] * fineOz;
}
