# Rockwell Metals — Next.js storefront

Next.js (App Router) port of the static Rockwell Metals prototype
(`../rockwell-test/rockwell-metals`). The design, copy, and simulated market
behavior are carried over 1:1.

## Run

```bash
npm run dev     # http://localhost:3000
npm run build && npm run start
```

## Pages

- `/` — homepage (live spot dashboard, drops, market preview, vault feature)
- `/market` — market floor demo (search, filters, sort — all client-side)
- `/product` — product detail (Gold Buffalo PDP)
- `/vault` — portfolio dashboard

### Catalog (placeholder data, internal testing only)

- `/gold` — all ~5,600 products across the four mint feeds
- `/gold/perth-mint`, `/gold/royal-canadian-mint`, `/gold/royal-mint`, `/gold/us-mint`
- `/gold/[mint]/[series]` — keyword-matched series pages (e.g. `/gold/us-mint/american-eagles`,
  `/gold/perth-mint/lunar-series`); definitions in `SERIES` in `app/data/catalog.ts`,
  with a per-mint "Collectibles" catch-all for unmatched titles
- `/on-sale` — Sale-badged products
- `/best-sellers` — products flagged "Top Pick"
- `/new-arrivals` — badge New / Pre-Sale / Coming Soon, or 2026-dated
- `/silver`, `/platinum` — metal detected from product titles
- `/product/[id]` — dynamic PDP for every catalog product (server-rendered on
  demand). CSV fields fill the real data; ratings, reviews, scarcity, serials,
  and related picks are deterministic dummy fills seeded on the product id
  (`app/data/pdp-fill.ts`, behavior in `app/lib/pdp.js`). Unpriced items render
  a "notify me" variant.

The navbar (shared `app/components/site-nav.tsx`) is: Best sellers ·
New arrivals · Gold (mega dropdown: Shop gold quick links + the four mints,
each with its series) · Silver · Platinum. The dropdown structure mirrors
`SERIES` — keep them in sync.

## Product data pipeline

- `data/apmex/*.csv` — raw scraped exports (checked in for internal testing;
  image URLs point at the source CDN — replace before anything public)
- `npm run build:data` — parses the CSVs into `app/data/products.json`
- `app/data/catalog.ts` — typed accessors + category/badge derivations
- `app/components/catalog-page.tsx` — server-rendered category template
  (tiles are static HTML; `app/lib/catalog.js` wires search/sort/filter,
  theme, spot ticker, and tape in the browser)

## Structure

- `app/styles.css` — shared stylesheet (verbatim from the prototype), loaded globally in `app/layout.tsx`
- `app/market/market.css`, `app/product/product.css`, `app/vault/vault.css` — page stylesheets, imported by their route only
- `app/*-client.tsx` / `app/*/**-client.tsx` — page markup (JSX conversion of the prototype HTML)
- `app/lib/*.js` — the prototype's page scripts, wrapped as `init*()` functions that React mounts in `useEffect` (intervals are tracked and cleared on unmount)
- `public/assets/` — logo and coin images

Notes carried over from the prototype:

- Prices, tickers, countdowns, fills, and the serial "verification" are all
  **simulated in the browser** — there are no network calls and no backend.
- Theme (dark default / light) persists via `localStorage["rm-theme"]`, applied
  pre-paint by an inline script in `app/layout.tsx`.
- Cross-page links are plain `<a>` full-page navigations on purpose: the page
  stylesheets reuse class names with different meanings (e.g. `.vault`), so CSS
  must stay route-scoped exactly like the original multi-page site.

Next step: replace the hardcoded tile/drop/holding markup with real product
data (extract into data modules and map over them in the client components).

## The system realm (auth · checkout · vault custody · admin ops)

Every route from `Rockwell_Metals_Master_User_Roles_Pages_and_Flows.docx` is implemented behind
`POST/GET /api/rm`, over one ledger document persisted through `app/lib/rm-store.ts`:

- `RM_STORE_DRIVER=file` (default) — `data/db.json`, one local process.
- `RM_STORE_DRIVER=postgres` — the `public.rockwell_store` row in Supabase via the service-role key, with
  optimistic concurrency, for Vercel/serverless or any multi-instance host. Apply
  `supabase/migrations/20260903_rockwell_catalog.sql` once (`psql "$DATABASE_URL" -f …`).

## Catalog (system of record: Supabase)

The launch catalog lives in the shared Supabase project as `rockwell_products`,
`rockwell_pricing_rules` and `rockwell_catalog_meta` (every Rockwell table carries the
`rockwell_` prefix — see [`supabase/README.md`](supabase/README.md) for the schema and the
one-command extraction). The app reads a JSON snapshot at startup:

```bash
npm run catalog:pull            # tables → app/data/products.json + launch-pricing.json
npm run catalog:push            # local JSON → tables (upsert; removes rows no longer present)
npm run catalog:pull -- --check # exit 1 if the local snapshot differs from the database
```

With `RM_CATALOG_SOURCE=supabase`, `npm run build` pulls automatically first, so every deploy
builds from the database. Product images are served from the `rockwell-products` storage bucket
in the same project.

**Environment** — copy `.env.example` to `.env.local`. `RM_SESSION_SECRET` (32+ random chars) is
required; the server refuses to start in production without it.

- **Run:** `npm run build && npx next start -p 3010` (or `npm run dev`).
- **First operator:** set `RM_BOOTSTRAP_ADMIN_EMAILS=you@company.com`, then open an account with that
  email at `/auth/sign-up` — it is created as SUPER_ADMIN (an existing customer with that email is
  promoted on the next store open). Further staff: `/admin/customers/<id>` → *Set role*.
- **Demo accounts** (`customer@rockwell.demo`, `admin@rockwell.demo`, … / `rockwell-demo-2026`) only work
  with `RM_DEMO_MODE=true`, and never in production. Reset demo data as a signed-in SUPER_ADMIN:
  `POST /api/rm {"action":"resetDemo"}`.
- **Orders** are priced on the server (`app/lib/order-pricing.ts`): every line is re-quoted from the
  catalog against the spot marks bound in the signed 120 s lock token from `/api/quote`; the browser's
  total is only compared for drift. KYC tier limits (`app/lib/kyc-limits.ts`) are enforced in the same
  place. Paid orders run assay → allocation server-side (`settlePaidOrder`) and mint vault passports.
- **Sign-in throttling:** per-IP and per-account sliding windows in `app/lib/rate-limit.ts` (in-process;
  add an edge/WAF rule on multi-instance hosts).
- **Password recovery** has no email step yet: `/auth/forgot-password` routes the customer to the support
  desk, a SUPPORT/SUPER_ADMIN runs `resetPassword` (one-time temporary password, audit-logged, never stored in
  clear), and the customer replaces it via the *Account security* panel on `/vault` (`changePassword`).
- **Delivery orders** carry a structured, validated `shipTo` (recipient, street, unit, city, state, ZIP,
  country, phone; no P.O. boxes). Drop allocations are consumed at settlement, never at claim time.
- **Spot cadence:** the shared `metal_prices` row is refreshed from the keyless upstream when older than
  15 minutes (`REFRESH_AFTER_MS`); marks older than an hour are labelled indicative; spot-linked quotes stop
  after 36 h. A second instance that refreshed first wins — no duplicate rows.
- **Pricing rule book repairs:** `npx tsx scripts/repair-launch-pricing.mts` applies the deterministic,
  idempotent corrections recorded under `repairs` in `app/data/launch-pricing.json` (weight fixes; dated
  coins with >60% premium re-classed SEMI_NUMISMATIC; inferred collector premiums held as quote-only).
- **Build inputs:** `npm run build` runs `scripts/check-build-inputs.mjs` first and stops with a
  one-screen explanation if the catalog or rule book is missing (`npm run check:inputs` also checks the
  session secret).
- **Page-by-page walkthrough:** `Rockwell_Metals_Page_Guide.pdf` (screenshot, purpose, and link for all 47 screens).

## Catalog state (2026-09-03)

- **Live catalog** = the 1,000-product launch set in `app/data/products.json`, with
  competitor-calibrated live pricing (`app/data/launch-pricing.json`). See
  [`docs/LIVE_PRICING.md`](docs/LIVE_PRICING.md).
- **Full 25,457-product AI-described catalog** is parked, reusable, in
  `archive/master-catalog-ai-25457/` (README inside explains how to restore it).
- **Older snapshots and the pre-AI scrape** are in `archive/legacy-backups-NEVER-USE/`.
  Never restore anything from there.
