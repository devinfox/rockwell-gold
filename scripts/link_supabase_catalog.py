#!/usr/bin/env python3
"""
Rockwell Metals · Automated Supabase Image Linker & Catalog Synchronizer
========================================================================
1. Connects to SQLite sync database (data/rockwell_image_sync_state.db).
2. Maps every product in app/data/products.json to its new cloaked Supabase CDN URLs.
3. Automatically sets primary 'image' and ordered multi-angle 'images' gallery.
4. Performs safe atomic write with automated timestamped backup.
5. Can be run standalone anytime or triggered automatically via the pipeline.
"""

import argparse
import json
import os
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP_DATA_DIR = ROOT / "app" / "data"
DATA_DIR = ROOT / "data"

LIVE_PRODUCTS_PATH = APP_DATA_DIR / "products.json"
STATE_DB_PATH = DATA_DIR / "rockwell_image_sync_state.db"
MAPPING_JSON_PATH = DATA_DIR / "rockwell_supabase_image_map.json"

# Mirrors VIEW_ORDER in rockwell_image_pipeline.py: decides which uploaded view
# represents a product and the order the remaining angles appear in.
VIEW_ORDER = ("primary", "obv", "front", "rev", "back", "slab", "angle", "raw", "box", "cert")
PRIMARY_VIEW_HINTS = ("primary", "obv", "front", "slab")


def view_priority(view: str) -> int:
    v = (view or "").lower()
    for idx, key in enumerate(VIEW_ORDER):
        if key in v:
            return idx
    return len(VIEW_ORDER)


def load_sync_mapping_from_db(db_path: Path) -> Dict[str, Dict]:
    if not db_path.exists():
        print(f"⚠️ State database not found at {db_path}")
        return {}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Query all completed uploads
    rows = cursor.execute("""
        SELECT source_url, product_sku, product_id, view_type, supabase_url, sha256_hash
        FROM image_tasks
        WHERE status = 'COMPLETED' AND supabase_url IS NOT NULL
    """).fetchall()
    conn.close()

    print(f"📊 Loaded {len(rows):,} completed Supabase image records from database.")

    # Build dual-indexed mapping: by SKU, by Product ID, and by original source URL
    sku_map = defaultdict(lambda: {"primary": None, "views": {}, "all_urls": []})
    pid_map = defaultdict(lambda: {"primary": None, "views": {}, "all_urls": []})
    url_to_supa = {}

    # Deterministic ordering: primary/obverse first, then the remaining angles.
    rows = sorted(rows, key=lambda r: (view_priority(r["view_type"]), (r["view_type"] or "")))

    for r in rows:
        src = r["source_url"]
        sku = (r["product_sku"] or "").strip()
        pid = str(r["product_id"] or "").strip()
        view = (r["view_type"] or "primary").lower()
        supa_url = r["supabase_url"]

        url_to_supa[src] = supa_url

        # View priority ordering
        is_primary_candidate = any(k in view for k in PRIMARY_VIEW_HINTS)

        if sku and sku != "UNKNOWN":
            if is_primary_candidate and not sku_map[sku]["primary"]:
                sku_map[sku]["primary"] = supa_url
            sku_map[sku]["views"][view] = supa_url
            if supa_url not in sku_map[sku]["all_urls"]:
                sku_map[sku]["all_urls"].append(supa_url)

        if pid and pid != "UNKNOWN":
            if is_primary_candidate and not pid_map[pid]["primary"]:
                pid_map[pid]["primary"] = supa_url
            pid_map[pid]["views"][view] = supa_url
            if supa_url not in pid_map[pid]["all_urls"]:
                pid_map[pid]["all_urls"].append(supa_url)

    # Fallback to first available URL if no explicit primary candidate
    for s, data in sku_map.items():
        if not data["primary"] and data["all_urls"]:
            data["primary"] = data["all_urls"][0]

    for p, data in pid_map.items():
        if not data["primary"] and data["all_urls"]:
            data["primary"] = data["all_urls"][0]

    return {
        "sku_map": dict(sku_map),
        "pid_map": dict(pid_map),
        "url_to_supa": url_to_supa
    }


_SKU_COUNTS: Dict[str, int] = {}


def _sku_is_unique(products: List[Dict], sku: str) -> bool:
    """A duplicated SKU must never be used to resolve imagery (see pipeline notes)."""
    global _SKU_COUNTS
    if not _SKU_COUNTS:
        for prod in products:
            key = (prod.get("sku") or "").strip()
            if key:
                _SKU_COUNTS[key] = _SKU_COUNTS.get(key, 0) + 1
    return _SKU_COUNTS.get(sku, 0) == 1


def link_catalog(dry_run: bool = False) -> Dict:
    if not LIVE_PRODUCTS_PATH.exists():
        print(f"❌ Products catalog not found at {LIVE_PRODUCTS_PATH}")
        return {}

    with open(LIVE_PRODUCTS_PATH, "r", encoding="utf-8") as f:
        products = json.load(f)

    print(f"📦 Loaded {len(products):,} live products from {LIVE_PRODUCTS_PATH.name}")

    mapping_data = load_sync_mapping_from_db(STATE_DB_PATH)
    sku_map = mapping_data.get("sku_map", {})
    pid_map = mapping_data.get("pid_map", {})
    url_to_supa = mapping_data.get("url_to_supa", {})

    stats = {
        "total_products": len(products),
        "primary_updated": 0,
        "already_supabase": 0,
        "galleries_added": 0,
        "unmatched": 0
    }

    updated_products = []

    for p in products:
        sku = (p.get("sku") or "").strip()
        pid = str(p.get("id") or "").strip()
        curr_img = p.get("image", "")
        # Product id is resolved before SKU: 2,408 SKUs are duplicated across
        # the catalog, so a SKU-first lookup can attach the wrong gallery.

        # Locate this product's uploaded image set. Kept separate from primary
        # resolution below: every live product's own image URL is harvested as a
        # task, so a direct URL hit always won the old elif-chain and the gallery
        # branches were unreachable for the entire catalog.
        entry = None
        if sku and sku in sku_map:
            entry = sku_map[sku]
        elif pid and pid in pid_map:
            entry = pid_map[pid]

        resolved_primary = None
        if curr_img in url_to_supa:
            resolved_primary = url_to_supa[curr_img]
        elif entry and entry["primary"]:
            resolved_primary = entry["primary"]

        # If already pointing to Supabase
        if "supabase.co/storage" in curr_img:
            stats["already_supabase"] += 1
        elif resolved_primary:
            p["image"] = resolved_primary
            stats["primary_updated"] += 1
        else:
            stats["unmatched"] += 1

        # Populate gallery images array if available, primary first.
        if entry:
            lead = p.get("image") or resolved_primary
            resolved_gallery = [u for u in entry["all_urls"] if u != lead]
            if lead:
                resolved_gallery.insert(0, lead)
            if len(resolved_gallery) > 1:
                p["images"] = resolved_gallery
                stats["galleries_added"] += 1

        updated_products.append(p)

    print("\n" + "="*50)
    print("📋 CATALOG LINKING RESULTS")
    print(f"  • Total Products in Catalog:  {stats['total_products']:,}")
    print(f"  • Primary Images Replaced:    {stats['primary_updated']:,}")
    print(f"  • Already on Supabase CDN:    {stats['already_supabase']:,}")
    print(f"  • Multi-Angle Galleries Added: {stats['galleries_added']:,}")
    print(f"  • Unmatched (Awaiting Sync):  {stats['unmatched']:,}")
    print("="*50 + "\n")

    # Export mapping lookup JSON
    with open(MAPPING_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "stats": stats,
            "sku_map": sku_map
        }, f, indent=2)
    print(f"💾 Master lookup mapping saved to {MAPPING_JSON_PATH}")

    if dry_run:
        print("🔍 Dry run complete. No files modified.")
        return stats

    # Create safety backup
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_file = LIVE_PRODUCTS_PATH.with_suffix(f".json.backup_{ts}")
    shutil.copy2(LIVE_PRODUCTS_PATH, backup_file)
    print(f"🛡️ Safety backup created at {backup_file.name}")

    # Write to a temp file in the same directory, then atomically swap it in, so
    # an interrupt mid-write cannot leave a truncated catalog behind.
    tmp_path = LIVE_PRODUCTS_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(updated_products, f, indent=2)
    os.replace(tmp_path, LIVE_PRODUCTS_PATH)

    print(f"✅ Successfully synchronized all links in {LIVE_PRODUCTS_PATH}!")
    return stats


def main():
    parser = argparse.ArgumentParser(description="Rockwell Metals · Supabase Image Auto-Linker")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and calculate links without modifying products.json")
    args = parser.parse_args()

    link_catalog(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
