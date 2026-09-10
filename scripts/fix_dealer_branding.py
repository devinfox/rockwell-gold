#!/usr/bin/env python3
"""
Rockwell Metals · Dealer-branding remediation
=============================================
Consumes data/dealer_branding_scan.json (from scan_dealer_branding.py). For every
live product whose primary image was flagged, tries the coin-only angles of the
same source listing (_obv / _rev variants of the original image URL).

Two phases, so the candidate photos can be reviewed by eye between them:

  --prepare   download + cloak each candidate angle into <dir>/candidates/
              and write <dir>/candidates.json  (no uploads, no catalog edits)
  --apply     read <dir>/verdicts.json  {candidate_url: true|false}  (true = clean),
              upload the first clean candidate per product to Supabase, record it
              in the SQLite sync DB, rewrite products.json / launch-pricing.json.
              Products with no clean candidate are removed from both files.

Timestamped backups of both catalog files are written before anything is modified.
A full report goes to data/dealer_branding_fix_report.json.
"""

import argparse
import asyncio
import hashlib
import json
import random
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
import certifi
import ssl

SSL_CTX = ssl.create_default_context(cafile=certifi.where())

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from rockwell_image_pipeline import (  # noqa: E402
    BUCKET_NAME, STATE_DB_PATH, SUPABASE_KEY, SUPABASE_URL, USER_AGENTS,
    SupabaseStorageClient, process_and_cloak_image_bytes, slugify,
)

ROOT = HERE.parent
PRODUCTS_PATH = ROOT / "app" / "data" / "products.json"
PRICING_PATH = ROOT / "app" / "data" / "launch-pricing.json"
SCAN_PATH = ROOT / "data" / "dealer_branding_scan.json"
REPORT_PATH = ROOT / "data" / "dealer_branding_fix_report.json"

ANGLE_SUFFIXES = ["_obv", "_Obv", "_rev", "_Rev"]
VARIANT_RE = re.compile(r"^(.*?)(?:_(?:slab|obv|rev|angle|raw|box|cert|alt\d*))?\.(jpe?g|png)$", re.I)


def candidate_urls(source_url: str) -> list[str]:
    base = source_url.split("?")[0]
    m = VARIANT_RE.match(base)
    if not m:
        return []
    stem, ext = m.group(1), m.group(2)
    out = []
    for suf in ANGLE_SUFFIXES:
        u = f"{stem}{suf}.{ext}"
        if u.lower() != base.lower() and u not in out:
            out.append(u)
    return out


def view_of(url: str) -> str:
    return "obverse" if "obv" in url.lower().rsplit("/", 1)[-1] else "reverse"


async def fetch(session: aiohttp.ClientSession, url: str) -> bytes | None:
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": f"https://{urlparse(url).netloc}/",
    }
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as res:
            if res.status != 200:
                return None
            data = await res.read()
            return data if len(data) > 100 else None
    except Exception:
        return None


def load_state():
    scan = json.loads(SCAN_PATH.read_text())
    products = json.loads(PRODUCTS_PATH.read_text())
    conn = sqlite3.connect(STATE_DB_PATH)
    supa2src = {s: u for u, s in conn.execute("SELECT source_url, supabase_url FROM image_tasks WHERE status='COMPLETED'")}
    conn.close()
    flagged = [p for p in products if scan.get(p["image"], {}).get("branded")]
    unscanned = [p for p in products if scan.get(p["image"], {}).get("branded") is None]
    return scan, products, supa2src, flagged, unscanned


async def prepare(workdir: Path, concurrency: int):
    scan, products, supa2src, flagged, unscanned = load_state()
    print(f"{len(products)} products · {len(flagged)} flagged · {len(unscanned)} unscanned")
    cdir = workdir / "candidates"
    cdir.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    loop = asyncio.get_running_loop()
    out = []

    async def one(p, session):
        src = supa2src.get(p["image"], "")
        entry = {"id": p["id"], "sku": p["sku"], "title": p["title"], "old_image": p["image"], "old_source": src,
                 "reason": scan[p["image"]].get("evidence"), "candidates": []}
        for cand in candidate_urls(src):
            async with sem:
                raw = await fetch(session, cand)
            if raw is None:
                continue
            try:
                webp, sha = await loop.run_in_executor(None, process_and_cloak_image_bytes, raw)
            except Exception:
                continue
            fn = cdir / f"{p['id']}_{view_of(cand)}_{hashlib.sha256(cand.encode()).hexdigest()[:6]}.webp"
            fn.write_bytes(webp)
            entry["candidates"].append({"url": cand, "view": view_of(cand), "file": str(fn), "raw_bytes": len(raw), "webp_bytes": len(webp), "sha256": sha})
        out.append(entry)

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=concurrency + 4, ssl=SSL_CTX)) as session:
        await asyncio.gather(*(one(p, session) for p in flagged))

    out.sort(key=lambda e: int(e["id"]) if e["id"].isdigit() else 0)
    (workdir / "candidates.json").write_text(json.dumps(out, indent=1))
    n_with = sum(1 for e in out if e["candidates"])
    print(f"candidates written for {n_with}/{len(out)} flagged products → {workdir / 'candidates.json'}")
    for e in out:
        if not e["candidates"]:
            print(f"  no alternate angle: {e['id']}  {e['title'][:70]}")


async def apply(workdir: Path, dry_run: bool):
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Missing Supabase credentials")
    scan, products, supa2src, flagged, unscanned = load_state()
    cands = json.loads((workdir / "candidates.json").read_text())
    verdicts = json.loads((workdir / "verdicts.json").read_text())  # candidate url -> True (clean) / False

    records = []
    supabase = SupabaseStorageClient(SUPABASE_URL, SUPABASE_KEY, BUCKET_NAME)
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=SSL_CTX)) as session:
        if not dry_run:
            await supabase.ensure_bucket(session)
        for e in cands:
            rec = {**{k: e[k] for k in ("id", "sku", "title", "old_image", "old_source", "reason")}, "action": "removed", "new_image": None, "new_source": None}
            for c in e["candidates"]:
                if verdicts.get(c["url"]) is not True:
                    continue
                webp = Path(c["file"]).read_bytes()
                target = f"products/{slugify(e['sku'])}/{c['view']}_{hashlib.sha256(c['url'].encode()).hexdigest()[:10]}.webp"
                public_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{target}"
                if not dry_run:
                    ok, result, status = await supabase.upload_object(session, target, webp)
                    if not ok:
                        print(f"  upload failed for {e['id']} ({status}): {result[:100]}")
                        continue
                    conn = sqlite3.connect(STATE_DB_PATH, timeout=30)
                    conn.execute("""INSERT OR REPLACE INTO image_tasks
                        (source_url, product_sku, product_id, view_type, target_path, supabase_url, status,
                         original_size_bytes, processed_size_bytes, sha256_hash, attempts)
                        VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, 1)""",
                        (c["url"], e["sku"], e["id"], c["view"], target, public_url, c["raw_bytes"], c["webp_bytes"], c["sha256"]))
                    conn.commit(); conn.close()
                rec.update(action="swapped", new_image=public_url, new_source=c["url"])
                break
            records.append(rec)

    swapped = [r for r in records if r["action"] == "swapped"]
    removed = [r for r in records if r["action"] == "removed"]
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "dry_run": dry_run,
              "scanned": len(products) - len(unscanned), "flagged": len(flagged), "swapped": len(swapped),
              "removed": len(removed), "unscanned_ids": [p["id"] for p in unscanned], "records": records}
    REPORT_PATH.write_text(json.dumps(report, indent=1))
    print(f"flagged {len(flagged)} → swapped {len(swapped)}, removed {len(removed)}")
    for r in removed:
        print(f"  REMOVE {r['id']:>5}  {r['title'][:70]}")
    if dry_run:
        print("dry run — nothing written")
        return

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    for path in (PRODUCTS_PATH, PRICING_PATH):
        shutil.copy2(path, path.with_name(f"{path.name}.pre_dealer_branding_fix_{ts}.bak"))

    swap_by_id = {r["id"]: r["new_image"] for r in swapped}
    remove_ids = {r["id"] for r in removed}
    new_products = []
    for p in products:
        if p["id"] in remove_ids:
            continue
        if p["id"] in swap_by_id:
            p["image"] = swap_by_id[p["id"]]
        new_products.append(p)
    PRODUCTS_PATH.write_text(json.dumps(new_products, indent=2, ensure_ascii=False) + "\n")

    pricing = json.loads(PRICING_PATH.read_text())
    before = len(pricing["rules"])
    pricing["rules"] = {k: v for k, v in pricing["rules"].items() if k not in remove_ids}
    PRICING_PATH.write_text(json.dumps(pricing, indent=2, ensure_ascii=False) + "\n")
    print(f"products.json {len(products)} → {len(new_products)} · pricing rules {before} → {len(pricing['rules'])} · report {REPORT_PATH.name}")


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--prepare", action="store_true")
    g.add_argument("--apply", action="store_true")
    ap.add_argument("--dir", type=Path, required=True, help="work directory for candidates/verdicts")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--concurrency", type=int, default=8)
    a = ap.parse_args()
    if a.prepare:
        asyncio.run(prepare(a.dir, a.concurrency))
    else:
        asyncio.run(apply(a.dir, a.dry_run))


if __name__ == "__main__":
    main()
