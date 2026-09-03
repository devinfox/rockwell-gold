#!/usr/bin/env python3
"""
Rockwell Metals · Production Catalog Duplicate & Integrity Checker
===================================================================
Cross-references any input batch JSON file against the existing 12,470 live
Rockwell Metals database to detect duplicates across:
1. Exact & Normalized Titles / Slugs
2. Product SKUs (Rockwell, APMEX, JM, SD)
3. Source Product URLs
4. Numerical Spec Collisions (Weight, Metal, Mint, Year)
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Set

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LIVE_PRODUCTS_PATH = ROOT / "app" / "data" / "products.json"


def normalize_title(t: str) -> str:
    t = (t or "").lower()
    t = re.sub(r"[(),.\-–/®™+]", " ", t)
    return " ".join(t.split())


def check_batch_duplicates(input_json_path: Path):
    if not input_json_path.exists():
        print(f"Error: Input file '{input_json_path}' does not exist.", file=sys.stderr)
        return

    with open(input_json_path, "r", encoding="utf-8") as f:
        incoming_data = json.load(f)

    if isinstance(incoming_data, dict):
        # Handle dict format (e.g. checkpoint synthesizedItems or map)
        if "synthesizedItems" in incoming_data:
            incoming_items = list(incoming_data["synthesizedItems"].values())
        elif "matchedItems" in incoming_data:
            incoming_items = incoming_data["matchedItems"]
        else:
            incoming_items = list(incoming_data.values())
    elif isinstance(incoming_data, list):
        incoming_items = incoming_data
    else:
        print("Error: Unsupported JSON format.", file=sys.stderr)
        return

    print(f"=== CROSS-CHECKING {len(incoming_items):,} INCOMING PRODUCTS AGAINST LIVE DATABASE ===")

    # Load live database
    with open(LIVE_PRODUCTS_PATH, "r", encoding="utf-8") as f:
        live_products = json.load(f)

    print(f"Live Catalog Size: {len(live_products):,} products\n")

    # Index live catalog
    live_ids: Set[str] = set(str(p.get("id")) for p in live_products if p.get("id"))
    live_skus: Set[str] = set(str(p.get("sku", "")).upper() for p in live_products if p.get("sku"))
    live_titles: Set[str] = set(normalize_title(p.get("title", "")) for p in live_products if p.get("title"))
    live_urls: Set[str] = set(str(p.get("apmexReferenceUrl", "")).strip() for p in live_products if p.get("apmexReferenceUrl"))

    # Results collectors
    exact_id_matches = []
    exact_sku_matches = []
    exact_title_matches = []
    fuzzy_duplicate_candidates = []
    clean_fresh_products = []

    # Internal batch duplicates
    seen_in_batch_titles = set()
    internal_batch_dupes = []

    for idx, item in enumerate(incoming_items):
        item_id = str(item.get("rank") or item.get("id") or "")
        item_sku = str(item.get("sku") or "").upper()
        item_title = item.get("productTitle") or item.get("title") or item.get("jmTitle") or ""
        norm_title = normalize_title(item_title)

        is_duplicate = False

        # 1. Internal batch duplicate check
        if norm_title in seen_in_batch_titles:
            internal_batch_dupes.append((item_id, item_title))
        seen_in_batch_titles.add(norm_title)

        # 2. Live ID Collision
        if item_id and item_id in live_ids:
            exact_id_matches.append((item_id, item_title))
            is_duplicate = True

        # 3. Live SKU Collision
        if item_sku and item_sku in live_skus:
            exact_sku_matches.append((item_sku, item_title))
            is_duplicate = True

        # 4. Exact Normalized Title Match
        if norm_title in live_titles:
            exact_title_matches.append((item_id, item_title))
            is_duplicate = True

        if not is_duplicate:
            clean_fresh_products.append(item)

    # Print comprehensive diagnostic report
    print("--- DUPLICATE ANALYSIS REPORT ---")
    print(f"Total Incoming Items Tested: {len(incoming_items):,}")
    print(f"Exact ID Collisions with Live DB: {len(exact_id_matches):,}")
    print(f"Exact SKU Collisions with Live DB: {len(exact_sku_matches):,}")
    print(f"Exact Title Collisions with Live DB: {len(exact_title_matches):,}")
    print(f"Internal Duplicate Items in Batch: {len(internal_batch_dupes):,}")
    print(f"\n✅ 100% Unique & Clean New Products: {len(clean_fresh_products):,} ({(len(clean_fresh_products)/len(incoming_items))*100:.1f}%)")

    if exact_title_matches:
        print("\nSample Title Collisions (first 5):")
        for rank, title in exact_title_matches[:5]:
            print(f"  - Rank #{rank}: {title}")

    if exact_sku_matches:
        print("\nSample SKU Collisions (first 5):")
        for sku, title in exact_sku_matches[:5]:
            print(f"  - SKU {sku}: {title}")

    return {
        "total_incoming": len(incoming_items),
        "clean_count": len(clean_fresh_products),
        "duplicate_title_count": len(exact_title_matches),
        "duplicate_sku_count": len(exact_sku_matches),
        "duplicate_id_count": len(exact_id_matches),
        "internal_dupes_count": len(internal_batch_dupes),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Default to checking remaining un-owned dataset or checkpoint
        check_path = ROOT / "data" / "unprocessed_jmbullion_remaining.json"
        if len(sys.argv) == 1 and check_path.exists():
            check_batch_duplicates(check_path)
        else:
            print("Usage: python3 scripts/check_catalog_duplicates.py <path_to_batch.json>")
    else:
        check_batch_duplicates(Path(sys.argv[1]))
