#!/usr/bin/env python3
"""
Rockwell Metals · SD Bullion Comprehensive Crawler & Specs Extractor
===================================================================
Crawls SD Bullion sitemaps and product pages to extract complete, structured
technical specifications (Metal Type, IRA Eligibility, Purity, Diameter mm, 
Thickness mm, Mint, Country, Grade, Denomination, and Tier Pricing).
"""

import asyncio
import csv
import json
import os
import re
import ssl
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Set
from urllib.parse import urlparse

import aiohttp
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "data"
OUTPUT_JSON = DATA_DIR / "sdbullion_all_product_data.json"
OUTPUT_CSV = DATA_DIR / "sdbullion_all_product_data.csv"

SITEMAP_URLS = [
    "https://sdbullion.com/feeds/sitemap.xml",
    "https://www.sdbullion.com/buy/sitemap.xml",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

EXCLUDE_PATTERNS = [
    r"/blog", r"/about", r"/contact", r"/customer", r"/checkout", r"/cart",
    r"/privacy", r"/terms", r"/faq", r"/shipping", r"/sell", r"/reviews",
    r"/gold-price", r"/silver-price", r"/platinum-price", r"/gold-prices-",
    r"/silver-prices-", r"/historical-", r"/charts", r"/news"
]


def is_valid_product_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    for pat in EXCLUDE_PATTERNS:
        if re.search(pat, path):
            return False
    return True


async def fetch_sitemap_urls(session: aiohttp.ClientSession) -> List[str]:
    found_urls = set()
    ssl_ctx = ssl._create_unverified_context()
    
    for sm_url in SITEMAP_URLS:
        try:
            async with session.get(sm_url, ssl=ssl_ctx, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    root = ET.fromstring(text)
                    for u in root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url"):
                        loc_elem = u.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
                        if loc_elem is not None and loc_elem.text:
                            loc = loc_elem.text.strip()
                            if is_valid_product_url(loc):
                                found_urls.add(loc)
        except Exception as e:
            print(f"[Warn] Error fetching sitemap {sm_url}: {e}", file=sys.stderr)
            
    return sorted(list(found_urls))


def parse_sd_product_html(url: str, html: str) -> Optional[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    
    # Check if page is a product page (has H1 and specs/pricing)
    h1_elem = soup.find("h1", {"class": lambda x: x and "page-title" in x}) or soup.find("h1")
    if not h1_elem:
        return None
        
    title = h1_elem.get_text(strip=True)
    if not title or "404" in title or "Not Found" in title:
        return None
        
    # Extract SKU from JSON-LD or meta/markup
    sku = ""
    json_ld_scripts = soup.find_all("script", {"type": "application/ld+json"})
    for s in json_ld_scripts:
        try:
            data = json.loads(s.get_text() or "{}")
            if data.get("@type") == "Product":
                sku = str(data.get("sku") or "")
                break
        except Exception:
            pass
            
    if not sku:
        sku_elem = soup.find("div", {"class": lambda x: x and "sku" in x}) or soup.find("span", {"itemprop": "sku"})
        if sku_elem:
            sku = sku_elem.get_text(strip=True).replace("SKU", "").replace(":", "").strip()

    # Extract all attributes from table.additional-attributes
    specs = {}
    specs_tables = soup.find_all("table", {"class": lambda x: x and "additional-attributes" in x}) or soup.find_all("table")
    for tbl in specs_tables:
        for tr in tbl.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if len(cells) >= 2:
                k = cells[0].get_text(strip=True)
                v = cells[1].get_text(strip=True)
                if k and v:
                    specs[k] = v

    # If no attributes found and no pricing, it's likely a category page
    if not specs and not sku:
        return None

    # Pricing Tiers
    tier_prices = []
    tier_tables = soup.find_all("table", {"class": lambda x: x and "prices-tier" in x})
    for tbl in tier_tables:
        for tr in tbl.find_all("tr"):
            cells = [td.get_text(strip=True) for td in tr.find_all(["th", "td"])]
            if len(cells) >= 2 and any(char.isdigit() for char in cells[1]):
                tier_prices.append({"qty": cells[0], "price": cells[1]})

    # Primary Image
    primary_img = ""
    img_elem = soup.find("img", {"class": lambda x: x and ("gallery-placeholder__image" in x or "product-image-photo" in x)}) or soup.find("meta", {"property": "og:image"})
    if img_elem:
        primary_img = img_elem.get("src") or img_elem.get("content") or ""

    # Normalization of core physical attributes
    metal = specs.get("Metal Type", "")
    purity = specs.get("Purity", "")
    weight = specs.get("Metal Content", "")
    mint = specs.get("Mint/ Manufacturer", specs.get("Mint", ""))
    year = specs.get("Year", "")
    diameter = specs.get("Diameter", "")
    thickness = specs.get("Thickness", "")
    grade = specs.get("Grade", specs.get("Condition", ""))
    face_value = specs.get("Denomination", "")
    ira = specs.get("IRA Approved", specs.get("IRA Eligible", ""))

    return {
        "url": url,
        "sku": sku,
        "title": title,
        "metal": metal,
        "purity": purity,
        "weight": weight,
        "mint": mint,
        "year": year,
        "diameter": diameter,
        "thickness": thickness,
        "grade": grade,
        "face_value": face_value,
        "ira_eligible": ira,
        "tier_prices": tier_prices,
        "primary_image": primary_img,
        "raw_specs": specs,
    }


async def scrape_single_url(session: aiohttp.ClientSession, url: str, ssl_ctx, semaphore: asyncio.Semaphore) -> Optional[Dict]:
    async with semaphore:
        try:
            async with session.get(url, headers=HEADERS, ssl=ssl_ctx, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                if resp.status == 200:
                    html = await resp.text()
                    return parse_sd_product_html(url, html)
        except Exception:
            return None
    return None


async def run_crawler(limit: Optional[int] = None, concurrency: int = 30):
    ssl_ctx = ssl._create_unverified_context()
    connector = aiohttp.TCPConnector(limit=concurrency, ssl=ssl_ctx)
    
    async with aiohttp.ClientSession(connector=connector, max_field_size=65536, max_line_size=65536) as session:
        print("[1/3] Ingesting SD Bullion sitemaps...")
        urls = await fetch_sitemap_urls(session)
        print(f"Found {len(urls):,} candidate URLs from SD Bullion.")
        
        if limit:
            urls = urls[:limit]
            print(f"Testing batch of {limit} URLs with concurrency={concurrency}...")

        semaphore = asyncio.Semaphore(concurrency)
        tasks = [scrape_single_url(session, u, ssl_ctx, semaphore) for u in urls]
        
        print("[2/3] Extracting complete product specifications...")
        results = []
        start_t = time.time()
        
        for idx, fut in enumerate(asyncio.as_completed(tasks), 1):
            res = await fut
            if res:
                results.append(res)
            if idx % 100 == 0 or idx == len(tasks):
                elapsed = time.time() - start_t
                rate = idx / (elapsed or 1)
                print(f"  Processed {idx}/{len(tasks)} ({len(results)} valid products found) - {rate:.1f} items/sec")

        print(f"[3/3] Saving {len(results):,} structured SD Bullion products to {OUTPUT_JSON}...")
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

        # Also write CSV summary
        if results:
            keys = ["sku", "title", "metal", "weight", "purity", "mint", "year", "diameter", "thickness", "grade", "face_value", "ira_eligible", "url", "primary_image"]
            with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
                writer.writeheader()
                for r in results:
                    writer.writerow(r)
                    
        print(f"Complete! Extracted {len(results):,} SD Bullion product records.")
        return results


if __name__ == "__main__":
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 else None
    asyncio.run(run_crawler(limit=limit_arg))
