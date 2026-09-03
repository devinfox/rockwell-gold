// Public spot quote. Read by the tickers, the vault valuation and the price lock
// so every surface shows the same mark (audit F-05). Backed by the shared
// `metal_prices` table — see lib/spot.ts for the refresh and fallback ladder.
//
// getSpot() never throws, but the route still guards so a provider outage
// returns the last-known mark with a short cache rather than a 5xx that empties
// every ticker on the page.

import { getSpot } from "../../lib/spot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quote = await getSpot();
    return Response.json(quote, {
      headers: {
        // Fresh marks may be cached briefly; indicative ones must not be.
        "Cache-Control": quote.live && !quote.stale ? "public, max-age=30, stale-while-revalidate=120" : "no-store",
      },
    });
  } catch (err) {
    console.error("[api/spot] unexpected failure:", err);
    return Response.json(
      { error: "spot unavailable" },
      { status: 503, headers: { "Retry-After": "15", "Cache-Control": "no-store" } },
    );
  }
}
