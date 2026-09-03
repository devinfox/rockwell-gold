// Live quote for launch products.
//
//   GET /api/quote?id=<catalog id>&qty=<n>     one full quote + a price-lock token
//   GET /api/quote?ids=<id>,<id>,...            compact batch for tickers/tapes (max 24)
//
// The PDP polls this to keep the buy box on the current mark, the checkout
// re-locks against it, and the home page tape / hero read the batch form.
// Everything is computed server-side from the shared spot feed and the launch
// rule book, so the client never reproduces pricing logic.
//
// The single-quote form also returns `lockToken`: a signed statement of the
// spot marks this quote used. placeOrder honours it for 120 s, so the price a
// customer locks on screen is the price the server settles at.

import { findProduct } from "../../data/pdp-fill";
import { livePricesFor, priceWithSpot } from "../../lib/pricing/live";
import { issueLockToken, LOCK_TTL_S } from "../../lib/pricing/lock-token";
import { getSpot } from "../../lib/spot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids");
  if (ids) {
    const products = ids.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 24).map(findProduct).filter((p): p is NonNullable<typeof p> => !!p);
    const prices = await livePricesFor(products);
    const items = products.map((p) => {
      const lp = prices.get(p.id);
      return {
        id: p.id, title: p.title, sku: p.sku, metal: p.metal, image: p.image,
        mode: lp?.mode ?? "enquire", cashPrice: lp && lp.mode !== "enquire" ? lp.cashPrice : null,
        cardPrice: lp && lp.mode !== "enquire" ? lp.railPrices.card : null,
        spotUsed: lp?.spotUsed ?? null, meltValue: lp?.meltValue ?? null, premiumUsd: lp?.premiumUsd ?? null,
        asOf: lp?.asOf ?? null, indicative: lp?.indicative ?? true,
      };
    });
    return Response.json({ items }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
  }
  const id = url.searchParams.get("id") ?? "";
  const qty = Math.max(1, Math.min(999, parseInt(url.searchParams.get("qty") ?? "1", 10) || 1));

  const p = findProduct(id);
  if (!p) return Response.json({ error: "unknown product" }, { status: 404 });

  const spot = await getSpot();
  const price = priceWithSpot(p, spot, qty);
  if (!price) return Response.json({ error: "product is not in the live-priced launch set" }, { status: 404 });

  const lockable = price.mode !== "enquire";
  return Response.json(
    {
      ...price,
      title: p.title, sku: p.sku, image: p.image, mint: p.mint,
      lockToken: lockable ? issueLockToken(spot) : null,
      lockTtlSeconds: lockable ? LOCK_TTL_S : 0,
    },
    // A quote carries a time-bound lock token; never let a cache hand out a stale one.
    { headers: { "Cache-Control": "no-store" } },
  );
}
