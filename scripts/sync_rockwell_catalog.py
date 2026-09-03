#!/usr/bin/env python3
"""
Sync Synthesized Rockwell Catalog into rockwell-gold App
=========================================================
Transforms the 3,851 synthesized Rockwell products into app/data/products.json
and copies all supporting CSV, JSON, and DB files into data/.
"""

import csv
import json
import re
import shutil
from pathlib import Path

SOURCE_DIR = Path("/Users/devin/Desktop/all-product-data")
RG_DIR = Path("/Users/devin/Desktop/Archive/Previous Desktop Cleanup (July 2026)/Projects/Folders/Archive/desktop-april/screenshot/DESKTOP 2026/projects/rockwell-gold")


def make_mint_slug(mint_name: str) -> str:
    m = (mint_name or "").lower()
    if "united states" in m or "u.s." in m or "us mint" in m:
        return "us-mint"
    if "canadian" in m or "rcm" in m:
        return "royal-canadian-mint"
    if "perth" in m:
        return "perth-mint"
    if "royal mint" in m:
        return "royal-mint"
    if "austrian" in m:
        return "austrian-mint"
    if "pamp" in m:
        return "pamp-suisse"
    if "valcambi" in m:
        return "valcambi"
    if "credit suisse" in m:
        return "credit-suisse"
    if "johnson matthey" in m:
        return "johnson-matthey"
    if "engelhard" in m:
        return "engelhard"
    if "silvertowne" in m:
        return "silvertowne"
    if "sunshine" in m:
        return "sunshine-minting"
    if "germania" in m:
        return "germania-mint"
    if "scottsdale" in m:
        return "scottsdale-mint"
    if "asahi" in m:
        return "asahi"
    if "geiger" in m:
        return "geiger"
    if "mexican" in m or "casa de moneda" in m:
        return "mexican-mint"
    if "south african" in m:
        return "south-african-mint"
    if "chinese" in m or "china gold" in m:
        return "chinese-mint"
    return "world-mints"


def parse_year(year_str: str) -> int | None:
    if not year_str:
        return None
    match = re.search(r"\b(18\d\d|19\d\d|20\d\d)\b", str(year_str))
    if match:
        return int(match.group(1))
    return None


def normalize_metal(metal_str: str) -> str:
    m = (metal_str or "").lower()
    if "gold" in m:
        return "gold"
    if "silver" in m:
        return "silver"
    if "platinum" in m:
        return "platinum"
    if "palladium" in m:
        return "palladium"
    return "other"


def main():
    print("Loading Synthesized Rockwell Catalog...")
    with open(SOURCE_DIR / "rockwell_synthesized_catalog.json", encoding="utf-8") as f:
        synthesized_items = json.load(f)

    print("Loading APMEX Pricing & Data...")
    with open(SOURCE_DIR / "apmex_all_product_data.csv", encoding="utf-8") as f:
        apmex_rows = {int(r["matched_rank"]): r for r in csv.DictReader(f)}

    print(f"Loaded {len(synthesized_items)} synthesized items and {len(apmex_rows)} pricing records.")

    products_list = []
    for item in synthesized_items:
        rank = int(item.get("rank", 0))
        ap_data = apmex_rows.get(rank, {})

        raw_price = ap_data.get("price")
        try:
            price_num = float(raw_price) if raw_price else None
        except ValueError:
            price_num = None

        if price_num:
            price_text = f"${price_num:,.2f}"
        else:
            price_text = ap_data.get("price_text") or "Call for price"

        badge = ap_data.get("badge") or ("Top Pick" if rank <= 50 else ("Sale" if rank % 7 == 0 else "In Stock"))

        metal_norm = normalize_metal(item.get("metal", ""))
        mint_name = item.get("mint", "World & Private Mints")
        mint_slug = make_mint_slug(mint_name)
        year_num = parse_year(item.get("year", ""))

        product_obj = {
            "id": str(rank),
            "sku": item.get("sku", f"RM-{rank}"),
            "title": item.get("product_title", ""),
            "price": price_num,
            "priceText": price_text,
            "badge": badge,
            "mint": mint_name,
            "mintSlug": mint_slug,
            "image": item.get("primary_image_url") or ap_data.get("primary_image", ""),
            "metal": metal_norm,
            "year": year_num,
            # Rich 4-Layer Rockwell Attributes
            "shortSummary": item.get("short_summary", ""),
            "fullDescription": item.get("full_description", ""),
            "metalContent": item.get("metal_content", ""),
            "purity": item.get("purity", ""),
            "gradeFinish": item.get("grade_finish", ""),
            "diameterMm": item.get("diameter_mm", ""),
            "thicknessMm": item.get("thickness_mm", ""),
            "faceValue": item.get("face_value", ""),
            "iraEligible": item.get("ira_eligible", "No"),
            "obverseDescription": item.get("obverse_description", ""),
            "reverseDescription": item.get("reverse_description", ""),
            "tags": item.get("tags", []),
            "apmexReferenceUrl": item.get("apmex_reference_url") or ap_data.get("product_url", ""),
        }
        products_list.append(product_obj)

    target_products_json = RG_DIR / "app" / "data" / "products.json"
    with open(target_products_json, "w", encoding="utf-8") as f:
        json.dump(products_list, f, indent=2)

    print(f"Wrote {len(products_list)} products to {target_products_json} ({target_products_json.stat().st_size / (1024*1024):.2f} MB)")

    # Copy files to rockwell-gold/data/
    target_data_dir = RG_DIR / "data"
    target_data_dir.mkdir(parents=True, exist_ok=True)
    for fname in [
        "rockwell_synthesized_catalog.csv",
        "rockwell_synthesized_catalog.json",
        "rockwell_catalog_progress.db",
        "apmex_all_product_data.csv",
        "jmbullion_all_product_data.csv",
        "aligned_apmex_vs_jmbullion.csv",
    ]:
        src_file = SOURCE_DIR / fname
        if src_file.exists():
            shutil.copy2(src_file, target_data_dir / fname)
            print(f"Copied {fname} -> rockwell-gold/data/{fname}")

    print("SYNC COMPLETE! rockwell-gold is now populated with the full 3,851 synthesized catalog!")


if __name__ == "__main__":
    main()
