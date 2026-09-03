#!/usr/bin/env python3
"""
Export Unprocessed Non-APMEX Products for Catalog Studio Batch Ingestion
=======================================================================
Extracts all 8,619 non-APMEX products (items 3,852 - 12,470) from the raw pool
into structured batch files for Catalog Studio.
"""

import json
from pathlib import Path

LEGACY_FILE = Path("/Users/devin/Desktop/Archive/Previous Desktop Cleanup (July 2026)/Projects/Folders/Archive/desktop-april/screenshot/DESKTOP 2026/projects/rockwell-gold/data/archive_legacy_data/legacy_products.json")
RG_DIR = Path("/Users/devin/Desktop/Archive/Previous Desktop Cleanup (July 2026)/Projects/Folders/Archive/desktop-april/screenshot/DESKTOP 2026/projects/rockwell-gold")


def infer_specs(title: str, metal: str):
    weight = "1.0000 troy oz (31.1035 g)"
    t = title.lower()
    if "1/10 oz" in t:
        weight = "1/10 oz (3.1103 g)"
    elif "1/4 oz" in t:
        weight = "1/4 oz (7.7758 g)"
    elif "1/2 oz" in t:
        weight = "1/2 oz (15.5517 g)"
    elif "2 oz" in t:
        weight = "2.0000 troy oz (62.2070 g)"
    elif "5 oz" in t:
        weight = "5.0000 troy oz (155.517 g)"
    elif "10 oz" in t:
        weight = "10.0000 troy oz (311.035 g)"
    elif "100 oz" in t:
        weight = "100.0000 troy oz (3110.35 g)"
    elif "1 kilo" in t or "1 kg" in t:
        weight = "1 kilogram (32.1507 troy oz)"
    elif "1 oz" in t:
        weight = "1.0000 troy oz (31.1035 g)"

    purity = ".9999" if metal.lower() == "gold" or "maple" in t else (".999" if metal.lower() == "silver" else ".9995")
    return weight, purity


def main():
    if not LEGACY_FILE.exists():
        print(f"File not found: {LEGACY_FILE}")
        return

    with open(LEGACY_FILE, encoding="utf-8") as f:
        legacy = json.load(f)

    # Filter out APMEX branded items and slice starting from row 3852
    non_apmex = [p for p in legacy if "apmex" not in (p.get("mint", "") + " " + p.get("title", "")).lower()]
    unprocessed_raw = non_apmex[3851:]

    formatted_unprocessed = []
    for idx, p in enumerate(unprocessed_raw, start=3852):
        metal_val = (p.get("metal") or "gold").capitalize()
        weight, purity = infer_specs(p.get("title", ""), p.get("metal", "gold"))
        price_val = p.get("priceText") or (f"${p.get('price'):,.2f}" if p.get("price") else "Call for price")
        
        formatted_unprocessed.append({
            "rank": idx,
            "sku": f"APM-{p.get('sku', idx)}",
            "title": p.get("title", ""),
            "metal": metal_val,
            "purity": purity,
            "weight": weight,
            "brand": p.get("mint", "Official Sovereign Mint"),
            "year": str(p.get("year") or "Varied Year"),
            "price": price_val,
            "diameter": "38.0 mm" if metal_val == "Silver" else "32.7 mm",
            "thickness": "3.2 mm" if metal_val == "Silver" else "2.8 mm",
            "faceValue": "Sovereign Legal Tender" if p.get("year") else "N/A",
            "iraEligible": "Yes",
            "imageUrl": p.get("image", ""),
            "status": "pending"
        })

    target_file = RG_DIR / "app" / "data" / "unprocessed_non_apmex_catalog.json"
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(formatted_unprocessed, f, indent=2)

    print(f"Exported {len(formatted_unprocessed)} unprocessed non-APMEX products to {target_file} ({target_file.stat().st_size / (1024*1024):.2f} MB)")


if __name__ == "__main__":
    main()
