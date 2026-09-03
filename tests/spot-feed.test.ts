import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Exercises app/lib/spot.ts against a mocked network: the shared metal_prices
// row, the stale-row upstream refresh + write-back, and total-outage fallback.

const URL = "https://example.supabase.co";
const row = (ageMs: number, gold = 4492.4) => [{
  gold, silver: 67.19, platinum: 1835, palladium: 1447,
  changes_percent: { gold: 2.75, silver: 3.16 }, source: "gold-api",
  fetched_at: new Date(Date.now() - ageMs).toISOString(),
}];

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
let script: (url: string, init?: RequestInit) => Response | Promise<Response>;

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

async function freshSpot() {
  vi.resetModules();
  return (await import("../app/lib/spot")).getSpot();
}

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.METALS_API_KEY;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    return script(url, init);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("spot feed", () => {
  it("serves the shared metal_prices row when it is fresh and never calls upstream", async () => {
    // "Fresh" = inside REFRESH_AFTER_MS (15 min). A dealer's live mark is minutes old, not hours.
    script = (url) => url.includes("/rest/v1/metal_prices") ? json(row(5 * 60_000)) : json({}, 500);
    const q = await freshSpot();
    expect(q.live).toBe(true);
    expect(q.prices.XAU).toBe(4492.4);
    expect(q.change.XAU).toBeCloseTo(0.0275, 6);
    expect(q.stale).toBe(false);
    expect(q.source).toContain("metal_prices");
    expect(calls.some((c) => c.url.includes("gold-api") || c.url.includes("metals-api"))).toBe(false);
  });

  it("refreshes from gold-api when the row is older than the refresh window and writes it back", async () => {
    script = (url, init) => {
      if (url.includes("/rest/v1/metal_prices") && (init?.method ?? "GET") === "GET") return json(row(7 * 3600_000, 4000));
      if (url.includes("/rest/v1/metal_prices") && init?.method === "POST") return new Response(null, { status: 201 });
      if (url.includes("api.gold-api.com/price/XAU")) return json({ price: 4510.5, updatedAt: new Date().toISOString() });
      if (url.includes("api.gold-api.com/price/XAG")) return json({ price: 67.8, updatedAt: new Date().toISOString() });
      if (url.includes("api.gold-api.com/price/XPT")) return json({ price: 1840, updatedAt: new Date().toISOString() });
      if (url.includes("api.gold-api.com/price/XPD")) return json({ price: 1450, updatedAt: new Date().toISOString() });
      return json({}, 500);
    };
    const q = await freshSpot();
    expect(q.live).toBe(true);
    expect(q.prices.XAU).toBe(4510.5);
    expect(q.stale).toBe(false);
    const write = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/metal_prices"));
    expect(write).toBeDefined();
    expect(JSON.parse(write!.body!).gold).toBe(4510.5);
    // day-change carried over from the last cron row
    expect(q.change.XAU).toBeCloseTo(0.0275, 6);
  });

  it("rejects an implausible upstream tick and keeps the stale row, flagged", async () => {
    script = (url) => {
      if (url.includes("/rest/v1/metal_prices")) return json(row(10 * 3600_000));
      if (url.includes("api.gold-api.com")) return json({ price: 0.001 });
      return json({}, 500);
    };
    const q = await freshSpot();
    expect(q.live).toBe(true);
    expect(q.prices.XAU).toBe(4492.4);
    expect(q.stale).toBe(true);
    expect(q.hardStale).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("falls back to reference marks, flagged not live and hard-stale, on a total outage", async () => {
    script = () => json({}, 500);
    const q = await freshSpot();
    expect(q.live).toBe(false);
    expect(q.hardStale).toBe(true);
    expect(q.prices.XAU).toBeGreaterThan(0);
  });

  it("uses metals-api when gold-api is down and inverts its per-USD rates", async () => {
    process.env.METALS_API_KEY = "k";
    script = (url, init) => {
      if (url.includes("/rest/v1/metal_prices") && (init?.method ?? "GET") === "GET") return json([]);
      if (url.includes("/rest/v1/metal_prices")) return new Response(null, { status: 201 });
      if (url.includes("api.gold-api.com")) return json({}, 503);
      if (url.includes("metals-api.com")) return json({ success: true, timestamp: Math.floor(Date.now() / 1000), rates: { XAU: 1 / 4500, XAG: 1 / 67, XPT: 1 / 1830, XPD: 1 / 1440 } });
      return json({}, 500);
    };
    const q = await freshSpot();
    expect(q.live).toBe(true);
    expect(q.prices.XAU).toBeCloseTo(4500, 6);
    expect(q.source).toBe("metals-api");
  });
});

describe("live price gating", () => {
  it("pauses spot-linked quotes on a hard-stale feed but keeps fixed asks", async () => {
    vi.resetModules();
    const { priceWithSpot } = await import("../app/lib/pricing/live");
    const dead = { prices: { XAU: 4492.4, XAG: 67.19, XPT: 1835, XPD: 1447 }, change: { XAU: 0, XAG: 0, XPT: 0, XPD: 0 },
                   asOf: new Date(0).toISOString(), source: "x", live: false, ageSeconds: 9e9, stale: true, hardStale: true };
    const bullion = priceWithSpot({ id: "1", sku: "S", title: "1 oz Canadian Silver Maple Leaf Coin BU", metal: "silver", metalContent: "1 troy oz" }, dead);
    expect(bullion?.mode).toBe("enquire");
    const fixed = priceWithSpot({ id: "276", sku: "N", title: "x", metal: "silver", metalContent: "0.7734 troy oz" }, dead);
    expect(fixed?.mode).toBe("fixed");
  });
});
