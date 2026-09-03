# Master catalog — 25,457 products with AI-generated names & descriptions

**Status: REUSABLE. This is the authoritative full catalog. Restore it in a few weeks when the site widens beyond the 1,000-product launch set.**

| File | What it is |
|---|---|
| `products.master.json` | The full live catalog as it was displayed on the site until 2026-09-03: 25,457 products, every record carrying the AI-written `shortSummary`, `fullDescription`, `obverseDescription`, `reverseDescription`, `tags`, and Supabase-hosted cloaked images (`image`, `images[]`). |
| `rockwell_supabase_image_map.json` | SKU → Supabase CDN image map produced by the image pipeline for this catalog. |

## Why it was archived

On 2026-09-03 the storefront was narrowed to the 1,000-product launch set
(`app/data/products.json`, selected by `scripts/select_launch_top_1000.py`)
so that live spot-linked pricing could be enabled on a curated, competitor-calibrated subset.
Nothing here was rejected; it is simply parked.

## How to bring it back

```bash
# 1. Restore the full catalog
cp archive/master-catalog-ai-25457/products.master.json app/data/products.json

# 2. Live pricing only covers ids present in app/data/launch-pricing.json.
#    Products without a rule fall back to their static priceText / "Enquire".
#    To calibrate more products, extend the launch set and rerun:
node --import ./scripts/ts-extension-hook.mjs scripts/build-launch-pricing.mts
```

`scripts/select_launch_top_1000.py` reads its candidate pool from this file, so
it keeps working while the live catalog is the 1,000-product subset.

## Do not confuse with

`archive/legacy-backups-NEVER-USE/` holds older snapshots and pre-AI data. Those
are kept only for forensics and must never be restored to `app/data/products.json`.
