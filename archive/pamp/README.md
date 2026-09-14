# PAMP products — pulled from the live catalog on 2026-09-14

All PAMP Suisse products (and any product carrying a PAMP-sourced image) were removed
from `app/data/products.json` and `app/data/launch-pricing.json` and pushed to Supabase.
Nothing here is referenced by the site. Kept so the records can be restored later.

| File | What it is |
|---|---|
| `products.json` | The 36 full product records exactly as they were in the live catalog. |
| `pricing-rules.json` | Their `launch-pricing.json` rule entries, keyed by product id. |
| `image-sources.json` | Every Supabase image URL per product, mapped back to the origin URL it was cloaked from. |

Pre-removal snapshots: `app/data/products.json.pre_pamp_removal_20260914_181321.bak` and
`app/data/launch-pricing.json.pre_pamp_removal_20260914_181321.bak` (gitignored, local only).

**To restore:** append the records from `products.json` back into `app/data/products.json`,
merge `pricing-rules.json` into the `rules` object of `app/data/launch-pricing.json`, then run
`npx tsx scripts/catalog-push.mts` and `npm test`. Note two galleries had wrong-product images
mixed in (id 131: a Royal Arms coin; id 1402: a 1984 Olympic commemorative), so trim those first.

## Products archived (36)

| id | SKU | Title | Metal | Price at removal |
|---|---|---|---|---|
| 131 | `RM-AU-PAMP-1OZ-BU` | 1 oz Gold Bar - PAMP Lady Fortuna VERISCAN™ (In Assay) | gold | $4,714.89 |
| 144 | `RM-AG-PAMP-1OZ-BU` | 1 oz Silver Bar - PAMP Lady Fortuna (In Assay) | silver | $98.05 |
| 149 | `RM-AU-PAMP-1K-BAR` | 1 Kilo Gold Bar - PAMP Suisse | gold | $151,101.46 |
| 404 | `RM-AU-PAMP-1G-BAR` | 1 gram Gold Bar - PAMP Lady Fortuna VERISCAN™ (In Assay) | gold | $211.79 |
| 501 | `RM-AU-PAMP-25G-BAR` | PAMP Suisse 25 x 1 Gram Gold Bar Multigram+ (In Assay) | gold | $4,539.93 |
| 403 | `RM-AU-PAMP-1OZ-BAR` | 1 oz Gold Bar - PAMP Suisse (In Assay) | gold | $4,764.89 |
| 541 | `RM-AU-PAMP-10OZ-BAR` | 10 oz Gold Bar - PAMP Suisse Lady Fortuna Veriscan® (w/Assay) | gold | $47,948.90 |
| 496 | `RM-AG-PAMP-BUFF-1OZ-BU` | 1 oz Silver Round - PAMP Buffalo | silver | $82.04 |
| 236 | `RM-AG-PAMP-10OZ-BU` | 2026 10 oz Silver Bar - PAMP Lunar Year of the Horse | silver | $810.50 |
| 767 | `RM-AU-PAMP-10G-BAR` | 10 gram Gold Bar - PAMP Lady Fortuna Veriscan® (In Assay) | gold | $1,637.96 |
| 644 | `RM-AG-PAMP-100OZ-BU` | 100 oz Silver Bar - PAMP Suisse | silver | $7,575.00 |
| 953 | `RM-AU-PAMP-2.5G-BAR` | 2.5 gram Gold Bar - PAMP Lady Fortuna Veriscan® (In Assay) | gold | $434.48 |
| 777 | `RM-AU-PAMP-5OZ-BU` | 5 oz Gold Bar - PAMP Suisse Lady Fortuna Veriscan® (w/Assay) | gold | AlertMe!® |
| 697 | `RM-AG-PAMP-1OZ-2014` | 2014 1 oz Silver Bar - PAMP Suisse (Year of the Horse) | silver | $268.05 |
| 836 | `RM-AU-PAMP-1G-2026` | 25 x 1 Gram Gold Bar PAMP Suisse Lunar Horse Multigram (In Assay) | gold | $4,429.93 |
| 991 | `RM-AU-PAMP-100G-BU` | 100 gram Gold Bar - PAMP Lady Fortuna Veriscan® (In Assay) | gold | $15,222.67 |
| 856 | `RM-AU-PAMP-1G-2018` | 2018 1 gram Gold Bar - PAMP Suisse Lunar Dog Multigram (In Assay) | gold | $219.71 |
| 1024 | `RM-AU-PAMP-1/2OZ-BAR` | 1/2 oz Gold Bar - PAMP Lady Fortuna Veriscan® (In Assay) | gold | $2,467.44 |
| 393 | `RM-AU-PAMP-1OZ-2024` | 2024 1 oz Gold Bar - PAMP Lunar Legends Azure Dragon (In Assay) | gold | AlertMe!® |
| 1159 | `RM-AU-PAMP-5G-VERISCAN` | 5 gram Gold Bar - PAMP Lady Fortuna Veriscan® (In Assay) | gold | $868.75 |
| 907 | `RM-AU-PAMP-1G-2019` | 1 Gram Gold Bar - PAMP Suisse Lunar Pig Multigram (In Assay) | gold | $370.85 |
| 1406 | `RM-PT-PAMP-25X1G-BAR` | 25 x 1 Gram Platinum Bar - PAMP Suisse Multigram+25 (In Assay) | platinum | $1,917.34 |
| 593 | `RM-AU-PAMP-1OZ-2025` | 2025 1 oz Gold Bar - PAMP Lunar Legends White Snake (In Assay) | gold | AlertMe!® |
| 1510 | `RM-AU-PAMP-50G-VERISCAN` | 50 gram Gold Bar - PAMP Suisse Lady Fortuna Veriscan (In Assay) | gold | $7,619.37 |
| 1533 | `RM-AU-PAMP-5G-BAR` | 5 Gram Gold Bar – PAMP Suisse Bald Eagle (Assay) | gold | $838.75 |
| 1655 | `RM-AU-PAMP-20G-BAR` | 20 gram Gold Bar - PAMP Lady Fortuna Veriscan® (In Assay) | gold | $3,130.93 |
| 1762 | `RM-AG-COD-1OZ-BU` | 1 oz Silver Call of Duty™ Gingerbread Ghost | silver | $149.99 |
| 1807 | `RM-AU-PAMP-1G-ASSAY` | 1 gram Gold Bar - PAMP Suisse Rosa (In Assay) | gold | $215.79 |
| 1914 | `RM-AU-PAMP-1G-VD` | 1 gram Gold Bar - PAMP Suisse | gold | $395.80 |
| 1919 | `RM-AU-PAMP-12X1G-BAR` | 12 x 1 Gram Gold Bar - PAMP Suisse Multigram+ (In Assay) | gold | $2,184.56 |
| 1209 | `RM-AU-PAMP-100G-2012` | 100 Gram Gold Bar - PAMP Suisse Year of the Dragon | gold | $15,061.92 |
| 846 | `RM-AU-PAMP-1OZ-BAR-2024` | 1 oz PAMP Suisse Gold Bar - Diwali Lakshmi & Peacocks | gold | AlertMe!® |
| 2084 | `RM-AG-PAMP-1OZ-BEZEL` | PAMP Suisse 1 oz Silver Bar in Bezel | silver | $159.99 |
| 2747 | `RM-PT-PAMP-51.454OZ-BU` | 51.454 oz Platinum Bar - PAMP Suisse | platinum | $90,584.26 |
| 2467 | `RM-PT-PAMP-5OZ-BAR` | 5 oz Platinum Bar - PAMP Suisse Lady Fortuna (In Assay) | platinum | AlertMe!® |
| 1402 | `RM-AU-PAMP-5G-2025` | 2025 5 Gram Gold Bar - PAMP Lunar Legends White Snake (In Assay) | gold | AlertMe!® |
