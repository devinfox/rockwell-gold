# Rockwell Metals on Supabase

Rockwell shares a Supabase project with other Tori Digital work. Everything
Rockwell owns in that project carries the `rockwell_` prefix so it can be
found, backed up, or moved out in one step.

| Table | Holds | Written by |
| --- | --- | --- |
| `rockwell_products` | the launch catalog, one row per product (typed columns + `extra` jsonb) | `scripts/catalog-push.mts` |
| `rockwell_pricing_rules` | one competitor-calibrated pricing rule per product (full rule in `rule` jsonb) | `scripts/catalog-push.mts` |
| `rockwell_catalog_meta` | rule-book header: version, spot reference, repairs log | `scripts/catalog-push.mts` |
| `rockwell_store` | the order / vault / audit ledger document, optimistic concurrency on `version` | the storefront server (`RM_STORE_DRIVER=postgres`) |

Also used but not owned: `metal_prices` (spot marks, shared with the citadel
cron) and the `rockwell-products` storage bucket (product images).

All four tables have row-level security enabled with no policies: only the
service-role key (the storefront server and these scripts) can read or write
them. The browser never touches them.

## Apply the schema

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260903_rockwell_catalog.sql
```

Idempotent; safe to re-run. (The direct `db.<ref>.supabase.co` host is
IPv6-only; from an IPv4 network use the session pooler
`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`.)

## Catalog flow

The database is the system of record; the app reads a JSON snapshot at startup
(`app/data/products.json`, `app/data/launch-pricing.json`), which keeps every
page and quote synchronous and fast.

```bash
npm run catalog:push          # local JSON → tables (upsert, removes stale rows)
npm run catalog:pull          # tables → local JSON (what the build uses)
npm run catalog:pull -- --check   # exit 1 if local snapshot differs from the database
```

With `RM_CATALOG_SOURCE=supabase` in the environment, `npm run build` pulls
automatically before compiling, so a deploy always builds from the database.

Editing flow: change the data (in the tables, or locally then `catalog:push`),
then redeploy or `catalog:pull` + restart.

## Extracting Rockwell into its own project

Two independent routes:

1. **SQL, everything including the ledger**
   ```bash
   pg_dump "$SOURCE_DATABASE_URL" --schema=public --table='public.rockwell_*' \
     --no-owner --no-privileges > rockwell.sql
   psql "$TARGET_DATABASE_URL" -f rockwell.sql
   ```
2. **JSON, catalog only** — `npx tsx scripts/catalog-pull.mts --out ./export`
   writes the complete catalog and rule book as portable JSON;
   `catalog-push.mts` loads them into any project that has the schema applied.

Then point the new project's `.env.local` at the new URL/keys and copy the
`rockwell-products` storage bucket (Supabase Storage → download, or the
original pipeline in `scripts/rockwell_image_pipeline.py` can re-upload).
