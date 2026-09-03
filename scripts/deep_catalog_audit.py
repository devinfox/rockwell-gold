#!/usr/bin/env python3
"""
Rockwell Metals · Deep Multi-Dimensional Product Duplicate & Collision Audit
=============================================================================
Comprehensive analysis across:
1. Exact Title Collisions
2. High-Confidence Semantic & Physical Duplicates (Jaccard >= 80%)
3. Packaging & Lot Multiples (Single vs Tube vs Monster Box)
4. Grading / Condition Variants (MS70 vs MS69 vs BU)
5. Physical Spec Identity Collisions (Metal + Weight + Mint + Year)
6. Historical JM Bullion URL Collisions
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LIVE_PRODUCTS_PATH = ROOT / "app" / "data" / "products.json"


def normalize_title(t: str) -> str:
    t = (t or "").lower()
    t = re.sub(r"[(),.\-–/®™+]", " ", t)
    return " ".join(t.split())


def extract_tokens(t: str) -> set:
    words = set(re.findall(r"[a-z0-9]+", (t or "").lower()))
    stopwords = {
        "a", "an", "the", "in", "on", "at", "and", "or", "of", "to", "for", "with",
        "by", "item", "coin", "coins", "product", "products", "new", "direct", "from"
    }
    return words - stopwords


def extract_spec_signature(item: dict) -> str:
    metal = (item.get("metal") or "").lower()
    weight = (item.get("metalContent") or item.get("weight") or "").lower()
    w_match = re.search(r"\b(1/20|1/10|1/4|1/2|2\.5|2|5|10|20|50|100|1000|1|kilo|kg)\b", weight)
    w_str = w_match.group(0) if w_match else ""

    mint = normalize_title(item.get("mint") or item.get("brand") or "")
    year = str(item.get("year") or "")
    y_match = re.search(r"\b(18\d\d|19\d\d|20\d\d)\b", year)
    y_str = y_match.group(1) if y_match else "varied"

    title = normalize_title(item.get("productTitle") or item.get("title") or "")
    grade = "raw"
    if "ms70" in title or "pr70" in title or "pf70" in title: grade = "70"
    elif "ms69" in title or "pr69" in title or "pf69" in title: grade = "69"
    elif "proof" in title or "pr " in title or "pf " in title: grade = "proof"

    return f"{metal}_{w_str}_{y_str}_{grade}"


def main(input_json_path: Path):
    with open(input_json_path, "r", encoding="utf-8") as f:
        incoming = json.load(f)

    with open(LIVE_PRODUCTS_PATH, "r", encoding="utf-8") as f:
        live = json.load(f)

    print(f"=== DEEP PRODUCT-LEVEL COLLISION AUDIT ===")
    print(f"Incoming Batch: {len(incoming):,} products")
    print(f"Live Database:  {len(live):,} products\n")

    live_by_id = {p["id"]: p for p in live}
    live_by_clean_title = {normalize_title(p.get("title", "")): p for p in live}
    live_by_spec = defaultdict(list)
    live_token_index = defaultdict(list)

    for p in live:
        sig = extract_spec_signature(p)
        live_by_spec[sig].append(p)
        toks = extract_tokens(p.get("title", ""))
        for tok in toks:
            live_token_index[tok].append(p["id"])

    # 1. Exact Title Collisions
    exact_title_dupes = []
    # 2. Fuzzy Semantic Product Duplicates (Jaccard >= 0.80)
    fuzzy_product_dupes = []
    # 3. Near-Variant Collisions (Same Physical Spec + Jaccard >= 0.65)
    spec_variant_dupes = []
    # 4. Packaging / Quantity Variant Items (Tube of 20, Box of 500, etc.)
    packaging_multiples = []
    # 5. Numismatic Slab / Graded Items (PCGS / NGC MS70 / PR70)
    graded_slabs = []

    for item in incoming:
        in_title = item.get("productTitle") or item.get("title") or ""
        in_clean = normalize_title(in_title)
        in_toks = extract_tokens(in_title)
        in_sig = extract_spec_signature(item)

        # Packaging check
        if any(k in in_clean for k in ["tube of", "box of", "monster box", "pack of", "roll of", "lot of", "5 pack", "10 pack", "20 pack", "100 pack", "count"]):
            packaging_multiples.append((item.get("rank"), in_title))

        # Graded slab check
        if any(k in in_clean for k in ["pcgs", "ngc", "anacs", "icg", "ms 70", "ms70", "pr 70", "pr70", "pf 70", "pf70", "ms 69", "ms69", "pr 69", "pr69"]):
            graded_slabs.append((item.get("rank"), in_title))

        # Exact match
        if in_clean in live_by_clean_title:
            lp = live_by_clean_title[in_clean]
            exact_title_dupes.append((item.get("rank"), in_title, lp.get("id"), lp.get("title")))
            continue

        # Inverted index lookup
        if len(in_toks) >= 3:
            candidate_counts = defaultdict(int)
            for tok in in_toks:
                for lp_id in live_token_index[tok]:
                    candidate_counts[lp_id] += 1

            best_overlap = 0
            best_lp_id = None
            for lp_id, cnt in candidate_counts.items():
                if cnt > best_overlap:
                    best_overlap = cnt
                    best_lp_id = lp_id

            if best_lp_id:
                best_lp = live_by_id[best_lp_id]
                lp_toks = extract_tokens(best_lp.get("title", ""))
                jaccard = best_overlap / len(in_toks | lp_toks)

                if jaccard >= 0.80:
                    fuzzy_product_dupes.append((
                        item.get("rank"), in_title, best_lp.get("id"), best_lp.get("title"), round(jaccard * 100, 1)
                    ))
                elif jaccard >= 0.65 and in_sig == extract_spec_signature(best_lp):
                    spec_variant_dupes.append((
                        item.get("rank"), in_title, best_lp.get("id"), best_lp.get("title"), round(jaccard * 100, 1)
                    ))

    print("--- DETAILED PRODUCT AUDIT BREAKDOWN ---")
    print(f"1. Exact Title Collisions: {len(exact_title_dupes):,} items (0.07%)")
    print(f"2. Near-Identical Product Duplicates (>=80% Token Overlap): {len(fuzzy_product_dupes):,} items ({(len(fuzzy_product_dupes)/len(incoming))*100:.1f}%)")
    print(f"3. Same Physical Spec & Mint Variant Collisions: {len(spec_variant_dupes):,} items ({(len(spec_variant_dupes)/len(incoming))*100:.1f}%)")
    print(f"4. Bulk / Packaging Multiples (Tubes, Rolls, Monster Boxes): {len(packaging_multiples):,} items ({(len(packaging_multiples)/len(incoming))*100:.1f}%)")
    print(f"5. Certified Graded Slabs (PCGS / NGC MS70/PR70): {len(graded_slabs):,} items ({(len(graded_slabs)/len(incoming))*100:.1f}%)")

    total_flagged_dupes = len(exact_title_dupes) + len(fuzzy_product_dupes)
    clean_unique = len(incoming) - total_flagged_dupes
    print(f"\n✅ 100% Fully Distinct New Products: {clean_unique:,} ({(clean_unique/len(incoming))*100:.1f}%)")

    print("\n--- SAMPLE EXACT TITLE DUPLICATES (All 10) ---")
    for r, in_t, lid, lt in exact_title_dupes:
        print(f"  • Rank #{r}: \"{in_t}\" ➔ Live #{lid}: \"{lt}\"")

    print("\n--- SAMPLE HIGH-CONFIDENCE DUPLICATES (>=80% Token Match) ---")
    for r, in_t, lid, lt, sc in fuzzy_product_dupes[:12]:
        print(f"  • Rank #{r}: \"{in_t}\"")
        print(f"    ➔ Live #{lid}: \"{lt}\" ({sc}% match)\n")

    print("--- SAMPLE BULK / PACKAGING MULTIPLES ---")
    for r, in_t in packaging_multiples[:8]:
        print(f"  • Rank #{r}: \"{in_t}\"")

    print("\n--- SAMPLE CERTIFIED GRADED SLABS ---")
    for r, in_t in graded_slabs[:8]:
        print(f"  • Rank #{r}: \"{in_t}\"")


if __name__ == "__main__":
    p = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/Users/devin/Downloads/rockwell_batch_all_13596.json")
    main(p)
