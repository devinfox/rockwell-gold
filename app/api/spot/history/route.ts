// Spot history for the market chart: GET /api/spot/history?range=1D|1W|1M|ALL
//
// Reads the shared `metal_prices` table (written by citadel's metals cron
// every ~5h, plus Rockwell's own stale-refresh writes), so the chart shows the
// same marks the rest of the site prices against. Rows begin 2026-07-01; there
// is no yearly history, so the ranges stop at ALL rather than pretending.

export const dynamic = "force-dynamic";

const RANGE_MS: Record<string, number> = {
  "1D": 24 * 3600_000,
  "1W": 7 * 24 * 3600_000,
  "1M": 31 * 24 * 3600_000,
  ALL: 10 * 365 * 24 * 3600_000,
};

type Row = { gold: string | number; silver: string | number; platinum: string | number; palladium: string | number; fetched_at: string };

export async function GET(req: Request) {
  const range = new URL(req.url).searchParams.get("range") ?? "1D";
  const span = RANGE_MS[range] ?? RANGE_MS["1D"];
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return Response.json({ range, points: [], live: false });

  // Extra look-back so a 1D window always has a starting point even between
  // 5-hourly cron rows.
  const since = new Date(Date.now() - span - 6 * 3600_000).toISOString();
  try {
    const res = await fetch(
      `${url}/rest/v1/metal_prices?select=gold,silver,platinum,palladium,fetched_at&fetched_at=gte.${encodeURIComponent(since)}&order=fetched_at.asc&limit=2000`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`metal_prices history ${res.status}`);
    const rows = (await res.json()) as Row[];
    // Downsample evenly to at most 160 points, always keeping the last row.
    const step = Math.max(1, Math.ceil(rows.length / 160));
    const points = rows
      .filter((_, i) => i % step === 0 || i === rows.length - 1)
      .map((r) => ({ t: new Date(r.fetched_at).toISOString(), XAU: Number(r.gold), XAG: Number(r.silver), XPT: Number(r.platinum), XPD: Number(r.palladium) }));
    return Response.json({ range, points, live: true, from: points[0]?.t ?? null, to: points[points.length - 1]?.t ?? null }, {
      headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[spot/history] unavailable:", err);
    return Response.json({ range, points: [], live: false });
  }
}
