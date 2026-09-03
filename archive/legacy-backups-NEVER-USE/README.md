# ⛔ NEVER USE — legacy catalog snapshots

**Nothing in this folder should ever be copied back into `app/data/products.json`.**
These files exist only so the history is auditable. The one and only reusable full
catalog is `archive/master-catalog-ai-25457/products.master.json`.

| File | What it is | Why it must not be used |
|---|---|---|
| `products.json.backup_20260828_192817` | Auto-backup taken by `scripts/link_supabase_catalog.py` before the last image-link pass. 25,457 products. | Image URLs point at origin CDNs (apmex / jmbullion), not the cloaked Supabase copies. Superseded by the master. |
| `products.json.backup_20260828_183557` | Earlier auto-backup from the same pass. 25,457 products. | Same as above. |
| `products.json.pre_apmex_filter.bak` | Snapshot before duplicate / APMEX-branded filtering. 25,527 products. | Contains 70 records that were deliberately removed (duplicates and APMEX-branded items). |
| `products.json.bak` | Mid-build snapshot. 12,470 products. | Incomplete catalog; JM Bullion batches were still being synthesized. |
| `legacy-non-ai/legacy_products.json` | The original scraped catalog. 12,836 products, **no AI descriptions, no summaries, no tags**. | This is the pre-AI data. It has none of the authored content the site depends on. |
| `legacy-non-ai/legacy_db.json` | The original local JSON store that accompanied it. | Superseded by `data/db.json`. |

If you think you need one of these, you almost certainly want the master catalog instead.
