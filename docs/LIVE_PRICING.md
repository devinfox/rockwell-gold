# Live pricing — launch set (1,000 products)

Enabled 2026-09-03. Applies to the products in `app/data/products.json` (the
launch set); the full 25,457-product catalog is parked in
`archive/master-catalog-ai-25457/` (see its README).

## Model (from the APMEX / JM Bullion deep dives)

| Class | Formula | Live | Storefront |
|---|---|---|---|
| **Bullion** (`BULLION_SPOT`) | `cash = live spot × fine oz + SKU premium`. Premium is a fixed **$ per item** for silver and sub-¼ oz units (how both dealers publish "over spot") and a **% of melt** for gold / platinum / palladium. Quantity tiers trim the premium (0 / −6% / −12%), never the metal leg. | 601 | "live" badge, requotes every 60 s |
| **Semi-numismatic** (`SEMI_NUMISMATIC`) | `cash = live spot × fine oz + managed collector premium ($)`. Proofs, graded moderns, random-year classics, rolls/bags. | 218 | "live" badge |
| **True numismatic** (`TRUE_NUMISMATIC`) | `cash = max(merchant ask, melt × (1 + floor))`. Pre-1933, dated/graded rarities. Spot is only a floor; a binding floor flags the desk. | 44 | "fixed ask" badge |
| Not auto-priced | 137 products: 84 collector pieces with no observed ask, 37 bullion whose observed ask was far above metal (lot prices, sets with medals, bad data), 16 rarities with no ask. | — | "Request a quote" |

Payment transform (both dealers): **card = cash ÷ 0.96**; wire/ACH and crypto settle at the cash price.

## Calibration (`scripts/build-launch-pricing.mts`)

For each product the **APMEX ask captured 2026-08-17…20** is compared with the
spot mark the shared `metal_prices` table recorded at that hour
(`data/spot_observations_aug2026.json`). The difference is the SKU premium
(or the collector leg, or the fixed ask). When APMEX gave nothing usable, a
**JM Bullion ask (2026-08-25)** is used instead, but only if the JM listing
title agrees with ours on weight, metal and wording — the research CSV's JM
matches are fuzzy and often wrong (`data/jm_observations.json`).

Bullion with no observation inherits the **median premium of its product
family** (backtest: 3.8% median price error, 78% within 10%) and is flagged
`needsReview`. Collector and rare pieces are never priced from an inferred
premium (backtest for collector premiums: 11% median error, 64% at p90) — they
show "Request a quote" until the desk sets `collectiblePremiumUsd` /
`merchantAskUsd`.

| Source of the premium | Live products |
|---|---|
| apmex-observed | 649 |
| jm-observed (title-verified) | 89 |
| family-median (bullion only) | 120 |
| metal-default (bullion only) | 5 |

### Verification (`scripts/verify-launch-pricing.mts`)

Every observed ask re-floated to today's spot, compared with the live price:

| | Products |
|---|---|
| Live products with a competitor comp | 738 of 863 |
| Within ±1% of the comp | 693 (93.9%) |
| Within ±5% of the comp | 730 (98.9%) |
| Inside the APMEX↔JM band (±3%) | 723 of 738 |
| Below the lowest comp by >5% | 0 |
| No comp (family-median / default bullion) | 125 |

Rebuild after changing the launch set or the rules:

```bash
python3 scripts/select_launch_top_1000.py           # -> data/launch_top_1000.json
node --import ./scripts/ts-extension-hook.mjs scripts/build-launch-pricing.mts
npm test
```

## Spot feed (`app/lib/spot.ts`)

Same design and same data as `citadel-website/lib/metals-cache.ts`: both sites
share one Supabase project, and citadel's cron (`/api/cron/metals`, ~every 5 h)
writes the upstream mark to `metal_prices`. Rockwell reads the latest row
(60 s in-memory memo). If that row is older than 6 h it refreshes upstream
itself — gold-api.com (keyless) then metals-api.com (`METALS_API_KEY`) — and
writes the row back. Quotes are flagged **indicative** past 6 h and **paused**
(request a quote) past 36 h.

Endpoints: `GET /api/spot` (shared mark), `GET /api/spot/history?range=1D|1W|1M|ALL`
(rows from `metal_prices` for the chart), `GET /api/quote?id=<id>&qty=<n>`
(full quote: cash + rail prices, melt, premium, tier ladder, explanation) and
`GET /api/quote?ids=a,b,c` (compact batch for tickers and tapes).

## Where it renders

- Home page Trading floor (`app/home-client.tsx` + `app/lib/home.js`): chart and
  24h stats from `/api/spot/history`; order stream, hero price and the per-metal
  "1 oz from" lines from `/api/quote?ids=…`; the bottom tape and the nav ticker
  are repainted from the same spot quote. No simulated price walks remain.
- Product page tape (`app/lib/pdp.js`): same sources as the home tape.
- Catalog tiles: `TilePrice` in `app/components/catalog-page.tsx`.
- PDP buy box: metal value / premium / spot shown separately; tiers and rails
  from the engine; `app/lib/pdp.js` polls `/api/quote` every 60 s.
- Checkout: "Refresh" re-locks against `/api/quote`; rails from `rules.ts`.

## Desk review

`launch-pricing.json` → filter `needsReview: true` (271 today: 137 not live + 134 live on an inherited or low-confidence-weight premium). Reasons are in
`reviewReasons`. Nothing in the catalog carries a cost basis yet, so the
margin floor in `quote.ts` cannot fire — supply `costBasisUsd` before scaling.
