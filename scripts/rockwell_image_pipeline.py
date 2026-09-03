#!/usr/bin/env python3
"""
Rockwell Metals · Production Image Ingestion, Cloaking & Supabase Storage Pipeline
==================================================================================
1. Harvests all product image links & multi-angle variations from live catalog & datasets.
2. In-memory async streaming (zero temporary disk files).
3. Strips all EXIF, XMP, IPTC forensic metadata.
4. Subtle visual perturbation (+1.2% brightness, +1.5% contrast, micro-jitter) to guarantee
   byte-for-byte uniqueness and break perceptual hash fingerprints (pHash/dHash).
5. Re-encodes to clean, high-quality WebP.
6. Direct streaming upload to Supabase Storage bucket ('rockwell-products') with CDN caching.
7. Fully resumable SQLite checkpoint engine for 80,000+ images.
8. CLI support for --inspect/--dry-run, --limit, --concurrency, and --update-catalog.
"""

import argparse
import asyncio
import csv
import hashlib
import io
import json
import os
import random
import re
import sqlite3
import sys
import time
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

import aiohttp
from dotenv import load_dotenv
from PIL import Image, ImageEnhance, ImageOps, ImageFile
from tqdm import tqdm

# Ensure truncated / slightly corrupt JPEG streams from CDNs do not crash PIL
ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = 100_000_000

# --- CONFIGURATION & PATHS ---
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = ROOT / "data"
APP_DATA_DIR = ROOT / "app" / "data"

LIVE_PRODUCTS_PATH = APP_DATA_DIR / "products.json"
JM_CSV_PATH = DATA_DIR / "jmbullion_all_product_data.csv"
SD_JSON_PATH = DATA_DIR / "sdbullion_all_product_data.json"
APMEX_CSV_PATH = DATA_DIR / "apmex_all_product_data.csv"
SYNTHESIZED_JSON_PATH = DATA_DIR / "rockwell_synthesized_catalog.json"
STATE_DB_PATH = DATA_DIR / "rockwell_image_sync_state.db"
OUTPUT_MAPPING_PATH = DATA_DIR / "rockwell_supabase_image_map.json"

# Load Supabase credentials (.env.local or fallback to ../crm/.env.local)
if (ROOT / ".env.local").exists():
    load_dotenv(ROOT / ".env.local")
elif (ROOT.parent / "crm" / ".env.local").exists():
    load_dotenv(ROOT.parent / "crm" / ".env.local")
else:
    load_dotenv()

SUPABASE_URL = (os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
BUCKET_NAME = "rockwell-products"

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

# Map CDN asset hosts to their authentic origin storefront for WAF/Cloudflare bypass
STOREFRONT_REFERERS = {
    "images-apmex.com": "https://www.apmex.com/",
    "www.images-apmex.com": "https://www.apmex.com/",
    "cdn.jmbullion.com": "https://www.jmbullion.com/",
    "static.jmbullion.com": "https://www.jmbullion.com/",
    "sdbullion.com": "https://sdbullion.com/",
    "preciousmetals-res.cloudinary.com": "https://sdbullion.com/",
}


# Ordering used to decide which uploaded view represents a product and in what
# order the remaining angles appear in the gallery array.
VIEW_ORDER = ("primary", "obv", "front", "rev", "back", "slab", "angle", "raw", "box", "cert")
PRIMARY_VIEW_HINTS = ("primary", "obv", "front", "slab")


def view_priority(view: str) -> int:
    v = (view or "").lower()
    for idx, key in enumerate(VIEW_ORDER):
        if key in v:
            return idx
    return len(VIEW_ORDER)


def is_primary_view(view: str) -> bool:
    v = (view or "").lower()
    return any(k in v for k in PRIMARY_VIEW_HINTS)


def slugify(text: any) -> str:
    text = str(text or "").lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[-\s]+", "-", text).strip("-")[:80]


# --- 1. STATE TRACKING DATABASE (SQLITE) ---
class SyncDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA busy_timeout=30000;")
        return conn

    @contextmanager
    def _connect(self):
        """Commit-on-success context manager that also CLOSES the connection.

        sqlite3's own `with conn:` block commits/rolls back but never closes, which
        leaked a connection per state write across tens of thousands of tasks.
        """
        conn = self._get_conn()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS image_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_url TEXT UNIQUE,
                    product_sku TEXT,
                    product_id TEXT,
                    view_type TEXT,
                    target_path TEXT,
                    supabase_url TEXT,
                    status TEXT DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED, SKIPPED
                    http_status INTEGER DEFAULT 0,
                    original_size_bytes INTEGER DEFAULT 0,
                    processed_size_bytes INTEGER DEFAULT 0,
                    sha256_hash TEXT,
                    attempts INTEGER DEFAULT 0,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON image_tasks(status);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sku ON image_tasks(product_sku);")

    def register_tasks(self, tasks: List[Dict]) -> int:
        with self._connect() as conn:
            cursor = conn.cursor()
            rows_before = cursor.execute("SELECT COUNT(*) FROM image_tasks").fetchone()[0]
            
            task_tuples = [
                (t["source_url"], str(t["product_sku"]), str(t["product_id"]), t["view_type"], t["target_path"])
                for t in tasks
            ]
            
            # Batch insert with executemany
            batch_size = 5000
            for i in range(0, len(task_tuples), batch_size):
                chunk = task_tuples[i:i + batch_size]
                cursor.executemany("""
                    INSERT OR IGNORE INTO image_tasks 
                    (source_url, product_sku, product_id, view_type, target_path, status)
                    VALUES (?, ?, ?, ?, ?, 'PENDING')
                """, chunk)
            
            conn.commit()
            rows_after = cursor.execute("SELECT COUNT(*) FROM image_tasks").fetchone()[0]
            return rows_after - rows_before

    def get_pending_tasks(self, limit: Optional[int] = None) -> List[Dict]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            query = "SELECT * FROM image_tasks WHERE status IN ('PENDING', 'FAILED') AND attempts < 4"
            if limit:
                query += f" LIMIT {limit}"
            rows = cursor.execute(query).fetchall()
            return [dict(r) for r in rows]

    def mark_completed(self, source_url: str, supabase_url: str, orig_size: int, proc_size: int, sha256: str):
        with self._connect() as conn:
            conn.execute("""
                UPDATE image_tasks
                SET status = 'COMPLETED',
                    supabase_url = ?,
                    original_size_bytes = ?,
                    processed_size_bytes = ?,
                    sha256_hash = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE source_url = ?
            """, (supabase_url, orig_size, proc_size, sha256, source_url))
            conn.commit()

    def mark_failed(self, source_url: str, http_status: int, error_msg: str):
        with self._connect() as conn:
            conn.execute("""
                UPDATE image_tasks
                SET status = 'FAILED',
                    http_status = ?,
                    attempts = attempts + 1,
                    error_message = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE source_url = ?
            """, (http_status, error_msg[:500], source_url))
            conn.commit()

    async def mark_completed_async(self, source_url: str, supabase_url: str, orig_size: int, proc_size: int, sha256: str):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, self.mark_completed, source_url, supabase_url, orig_size, proc_size, sha256
        )

    async def mark_failed_async(self, source_url: str, http_status: int, error_msg: str):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.mark_failed, source_url, http_status, error_msg)

    def get_stats(self) -> Dict:
        with self._connect() as conn:
            cursor = conn.cursor()
            total = cursor.execute("SELECT COUNT(*) FROM image_tasks").fetchone()[0]
            completed = cursor.execute("SELECT COUNT(*) FROM image_tasks WHERE status = 'COMPLETED'").fetchone()[0]
            pending = cursor.execute("SELECT COUNT(*) FROM image_tasks WHERE status = 'PENDING'").fetchone()[0]
            failed = cursor.execute("SELECT COUNT(*) FROM image_tasks WHERE status = 'FAILED'").fetchone()[0]
            total_bytes = cursor.execute("SELECT SUM(processed_size_bytes) FROM image_tasks WHERE status = 'COMPLETED'").fetchone()[0] or 0
            return {
                "total": total,
                "completed": completed,
                "pending": pending,
                "failed": failed,
                "total_mb_uploaded": round(total_bytes / (1024 * 1024), 2)
            }

    def export_completed_mapping(self) -> Dict[str, Dict]:
        """Returns map of product_sku -> {"primary": url, "gallery": [{"view", "url"}]}.

        Gallery entries are deduplicated and ordered by view priority so that
        gallery[0] is always the primary view rather than arbitrary row order.
        Rows without a usable SKU are dropped instead of collapsing into a
        single "UNKNOWN" bucket.
        """
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            rows = cursor.execute("""
                SELECT product_sku, product_id, view_type, supabase_url 
                FROM image_tasks 
                WHERE status = 'COMPLETED' AND supabase_url IS NOT NULL
            """).fetchall()

            grouped = defaultdict(list)
            for r in rows:
                sku = (r["product_sku"] or "").strip()
                if not sku or sku.upper() == "UNKNOWN":
                    continue
                view = (r["view_type"] or "primary").lower()
                grouped[sku].append((view_priority(view), view, r["supabase_url"]))

            result: Dict[str, Dict] = {}
            for sku, items in grouped.items():
                items.sort(key=lambda x: (x[0], x[1]))
                seen: Set[str] = set()
                gallery = []
                for _, view, url in items:
                    if url in seen:
                        continue
                    seen.add(url)
                    gallery.append({"view": view, "url": url})
                primary = next(
                    (url for _, view, url in items if is_primary_view(view)),
                    gallery[0]["url"] if gallery else None,
                )
                result[sku] = {"primary": primary, "gallery": gallery}
            return result


# --- 2. MULTI-SOURCE URL HARVESTER ---
def harvest_all_product_image_tasks() -> List[Dict]:
    """
    Harvests all primary and multi-angle gallery image links across:
    - app/data/products.json (live catalog)
    - data/jmbullion_all_product_data.csv (galleries in all_images_json)
    - data/sdbullion_all_product_data.json (primary & gallery)
    - data/apmex_all_product_data.csv (derived multi-angle obv/rev/slab/angle/box)
    """
    print("🔍 Harvesting all product image links from catalog datasets...")
    tasks: List[Dict] = []
    seen_urls: Set[str] = set()

    def create_task(source_url: str, sku: str, pid: str, view_type: str) -> Optional[Dict]:
        if not source_url or not isinstance(source_url, str):
            return None
        url = source_url.strip()
        if not url.startswith("http"):
            return None
        if "placeholder" in url.lower() or "default" in url.lower():
            return None
        if url in seen_urls:
            return None
        seen_urls.add(url)

        # Generate clean deterministic path for Supabase Storage
        # Key the storage path on the product id, which is unique. Keying it on
        # the SKU collided: the catalog holds 25,457 unique ids but only 23,049
        # unique SKUs, so 2,408 duplicates shared a storage prefix and could
        # cross-link one product's gallery onto another.
        key_clean = slugify(pid or sku or "item")
        url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()[:10]
        view_clean = slugify(view_type or "primary")
        target_path = f"products/{key_clean}/{view_clean}_{url_hash}.webp"

        return {
            "source_url": url,
            "product_sku": sku or pid or "UNKNOWN",
            "product_id": pid or sku or "UNKNOWN",
            "view_type": view_clean,
            "target_path": target_path,
        }

    # 1. Live Catalog (app/data/products.json)
    if LIVE_PRODUCTS_PATH.exists():
        try:
            with open(LIVE_PRODUCTS_PATH, "r", encoding="utf-8") as f:
                live_prods = json.load(f)
            for p in live_prods:
                sku = p.get("sku") or p.get("id") or ""
                pid = str(p.get("id") or "")
                if p.get("image"):
                    t = create_task(p["image"], sku, pid, "primary")
                    if t: tasks.append(t)
                for i, img in enumerate(p.get("images") or []):
                    t = create_task(img, sku, pid, f"gallery_{i}")
                    if t: tasks.append(t)
            print(f"  ✓ Live Catalog: {len(live_prods):,} products scanned")
        except Exception as e:
            print(f"  ⚠️ Error reading live products.json: {e}")

    # 2. JM Bullion CSV (data/jmbullion_all_product_data.csv)
    if JM_CSV_PATH.exists():
        try:
            with open(JM_CSV_PATH, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                jm_count = 0
                for row in reader:
                    jm_count += 1
                    sku = row.get("sku") or row.get("product_id") or ""
                    pid = row.get("product_id") or ""
                    if row.get("primary_image"):
                        t = create_task(row["primary_image"], sku, pid, "jm_primary")
                        if t: tasks.append(t)
                    
                    # Parse all_images_json
                    all_imgs_raw = row.get("all_images_json")
                    if all_imgs_raw:
                        try:
                            imgs = json.loads(all_imgs_raw)
                            if isinstance(imgs, list):
                                for idx, img_url in enumerate(imgs):
                                    view_tag = f"jm_angle_{idx}"
                                    if "front" in img_url.lower(): view_tag = "jm_obv"
                                    elif "back" in img_url.lower(): view_tag = "jm_rev"
                                    t = create_task(img_url, sku, pid, view_tag)
                                    if t: tasks.append(t)
                        except Exception:
                            pass
            print(f"  ✓ JM Bullion Dataset: {jm_count:,} products scanned")
        except Exception as e:
            print(f"  ⚠️ Error reading JM Bullion CSV: {e}")

    # 3. SD Bullion JSON (data/sdbullion_all_product_data.json)
    if SD_JSON_PATH.exists():
        try:
            with open(SD_JSON_PATH, "r", encoding="utf-8") as f:
                sd_items = json.load(f)
            for item in sd_items:
                sku = item.get("sku") or item.get("title") or ""
                pid = item.get("url") or ""
                if item.get("primary_image"):
                    t = create_task(item["primary_image"], sku, pid, "sd_primary")
                    if t: tasks.append(t)
                for idx, img_url in enumerate(item.get("images") or []):
                    t = create_task(img_url, sku, pid, f"sd_gallery_{idx}")
                    if t: tasks.append(t)
            print(f"  ✓ SD Bullion Dataset: {len(sd_items):,} products scanned")
        except Exception as e:
            print(f"  ⚠️ Error reading SD Bullion JSON: {e}")

    # 4. APMEX Dataset & Derived Multi-Angle Suffixes (data/apmex_all_product_data.csv)
    if APMEX_CSV_PATH.exists():
        try:
            with open(APMEX_CSV_PATH, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                apmex_count = 0
                for row in reader:
                    apmex_count += 1
                    sku = row.get("sku") or row.get("product_id") or ""
                    pid = row.get("product_id") or ""
                    prim_img = row.get("primary_image", "").strip()
                    if prim_img:
                        t = create_task(prim_img, sku, pid, "apmex_primary")
                        if t: tasks.append(t)

                        # Check if product has multiple angles based on image_count
                        try:
                            img_count = int(row.get("image_count") or 1)
                        except:
                            img_count = 1

                        if img_count > 1 and "images-apmex.com/images/products/" in prim_img:
                            # Standard APMEX angle suffix variants
                            base_match = re.match(r"^(.*?)(?:_(?:slab|obv|rev|angle|raw|box|cert|alt\d*))?\.jpg$", prim_img, re.IGNORECASE)
                            if base_match:
                                base_stem = base_match.group(1)
                                angle_suffixes = [
                                    ("_obv.jpg", "obverse"),
                                    ("_rev.jpg", "reverse"),
                                    ("_slab.jpg", "slab"),
                                    ("_angle.jpg", "angle"),
                                    ("_raw.jpg", "raw"),
                                    ("_box.jpg", "box"),
                                    ("_cert.jpg", "cert")
                                ]
                                for suffix, view_label in angle_suffixes:
                                    derived_url = f"{base_stem}{suffix}"
                                    if derived_url != prim_img:
                                        t = create_task(derived_url, sku, pid, f"apmex_{view_label}")
                                        if t: tasks.append(t)
            print(f"  ✓ APMEX Dataset: {apmex_count:,} products scanned with multi-angle expansion")
        except Exception as e:
            print(f"  ⚠️ Error reading APMEX CSV: {e}")

    # 5. Rockwell Synthesized & Secondary Datasets
    extra_sources = [
        (DATA_DIR / "unprocessed_jmbullion_remaining.json", "unprocessed_jm"),
        (DATA_DIR / "other_metals_categorized.csv", "other_metals"),
        (DATA_DIR / "rockwell_synthesized_catalog.json", "synthesized_catalog"),
        (DATA_DIR / "aligned_jm_vs_sdbullion.json", "aligned_jm_sd"),
        (APP_DATA_DIR / "unprocessed_non_apmex_catalog.json", "non_apmex_catalog"),
    ]

    for path, source_tag in extra_sources:
        if not path.exists():
            continue
        try:
            if path.suffix == ".json":
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    items = data if isinstance(data, list) else data.values()
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        sku = item.get("sku") or item.get("id") or item.get("title") or ""
                        pid = str(item.get("id") or item.get("product_id") or "")
                        for img_key in ("image", "primary_image", "imageUrl", "primaryImageUrl", "jm_image"):
                            if item.get(img_key):
                                t = create_task(item[img_key], sku, pid, f"{source_tag}_primary")
                                if t: tasks.append(t)
                        for gallery_key in ("images", "gallery", "galleryImages"):
                            if item.get(gallery_key) and isinstance(item[gallery_key], list):
                                for idx, g_url in enumerate(item[gallery_key]):
                                    t = create_task(g_url, sku, pid, f"{source_tag}_gallery_{idx}")
                                    if t: tasks.append(t)
            elif path.suffix == ".csv":
                with open(path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        sku = row.get("sku") or row.get("id") or row.get("title") or ""
                        pid = str(row.get("id") or row.get("product_id") or "")
                        for img_key in ("image", "image_url", "primary_image", "primaryImageUrl", "imageUrl"):
                            if row.get(img_key):
                                t = create_task(row[img_key], sku, pid, f"{source_tag}_primary")
                                if t: tasks.append(t)
            print(f"  ✓ Extra Dataset ({path.name}): Scanned successfully")
        except Exception as e:
            print(f"  ⚠️ Error reading {path.name}: {e}")

    print(f"✨ Total Unique Harvested Image Tasks: {len(tasks):,}\n")
    return tasks


# --- 3. IN-MEMORY IMAGE TRANSFORMATION & CLOAKING ---
def process_and_cloak_image_bytes(raw_bytes: bytes) -> Tuple[bytes, str]:
    """
    Transforms raw image buffer in RAM:
    1. Strips all EXIF, IPTC, XMP metadata forensic tags.
    2. Auto-orients based on original EXIF without preserving tags.
    3. Normalizes color channels to RGB.
    4. Applies subtle perceptual perturbation (+1.2% brightness, +1.5% contrast, micro-jitter).
    5. Re-encodes into clean, high-quality WebP.
    Returns: (webp_bytes, sha256_hash)
    """
    with Image.open(io.BytesIO(raw_bytes)) as img:
        # Correct rotation then strip metadata
        img = ImageOps.exif_transpose(img)

        # Handle RGBA/Paletted transparency by composite onto white background
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            alpha = img.convert("RGBA").split()[-1]
            bg.paste(img.convert("RGB"), mask=alpha)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Subtle contrast & brightness enhancement (visually imperceptible, breaks perceptual hashes)
        b_factor = round(random.uniform(1.011, 1.014), 4) # ~ +1.2%
        c_factor = round(random.uniform(1.014, 1.018), 4) # ~ +1.5%
        
        img = ImageEnhance.Brightness(img).enhance(b_factor)
        img = ImageEnhance.Contrast(img).enhance(c_factor)

        # Re-encode to clean WebP in memory
        out_buf = io.BytesIO()
        img.save(
            out_buf,
            format="WEBP",
            quality=92,
            method=4,
            lossless=False,
            exact=False
        )
        webp_bytes = out_buf.getvalue()
        sha256 = hashlib.sha256(webp_bytes).hexdigest()

        return webp_bytes, sha256


# --- 4. SUPABASE STORAGE BUCKET MANAGER ---
class SupabaseStorageClient:
    def __init__(self, supabase_url: str, service_role_key: str, bucket_name: str):
        self.base_url = supabase_url.rstrip("/")
        self.key = service_role_key
        self.bucket = bucket_name
        self.headers = {
            "Authorization": f"Bearer {self.key}",
            "apiKey": self.key,
        }

    async def ensure_bucket(self, session: aiohttp.ClientSession) -> bool:
        """Verifies or creates the public storage bucket in Supabase."""
        get_url = f"{self.base_url}/storage/v1/bucket/{self.bucket}"
        async with session.get(get_url, headers=self.headers) as res:
            if res.status == 200:
                return True

        # Create bucket if missing
        create_url = f"{self.base_url}/storage/v1/bucket"
        payload = {
            "id": self.bucket,
            "name": self.bucket,
            "public": True,
            "file_size_limit": 15728640, # 15 MB
            "allowed_mime_types": ["image/webp", "image/jpeg", "image/png"]
        }
        async with session.post(create_url, headers={**self.headers, "Content-Type": "application/json"}, json=payload) as res:
            if res.status in (200, 201):
                print(f"✅ Created public Supabase bucket '{self.bucket}'")
                return True
            else:
                text = await res.text()
                print(f"⚠️ Bucket check/creation warning ({res.status}): {text}")
                return False

    async def upload_object(self, session: aiohttp.ClientSession, path: str, data: bytes) -> Tuple[bool, str, int]:
        """Uploads binary data directly to Supabase storage bucket."""
        upload_url = f"{self.base_url}/storage/v1/object/{self.bucket}/{path}"
        headers = {
            **self.headers,
            "Content-Type": "image/webp",
            "x-upsert": "true",
            "Cache-Control": "public, max-age=31536000, immutable"
        }
        async with session.post(upload_url, headers=headers, data=data) as res:
            if res.status in (200, 201):
                public_url = f"{self.base_url}/storage/v1/object/public/{self.bucket}/{path}"
                return True, public_url, res.status
            else:
                err = await res.text()
                return False, err, res.status


# --- 5. ASYNC WORKER POOL & THROTTLED PIPELINE ---
MAX_ATTEMPTS_PER_RUN = 3


def get_domain_semaphore(
    domain_semaphores: Dict[str, asyncio.Semaphore], domain: str, default_limit: int
) -> asyncio.Semaphore:
    """Per-origin throttle, created on demand.

    Every domain gets its OWN semaphore. Previously unlisted domains fell back to
    the global semaphore, which the worker had already acquired -- asyncio
    semaphores are not reentrant, so that double-acquire deadlocked the run.
    """
    sem = domain_semaphores.get(domain)
    if sem is None:
        sem = asyncio.Semaphore(default_limit)
        domain_semaphores[domain] = sem
    return sem


async def process_single_task(
    task: Dict,
    session: aiohttp.ClientSession,
    supabase: SupabaseStorageClient,
    db: SyncDatabase,
    domain_semaphores: Dict[str, asyncio.Semaphore],
    domain_limit: int,
    pbar: tqdm
):
    """Download -> transform -> upload one image.

    Records exactly one terminal state per invocation and advances the progress
    bar exactly once, on every exit path.
    """
    source_url = task["source_url"]
    target_path = task["target_path"]
    parsed_domain = urlparse(source_url).netloc
    domain_sem = get_domain_semaphore(domain_semaphores, parsed_domain, domain_limit)

    referer_url = STOREFRONT_REFERERS.get(parsed_domain, f"https://{parsed_domain}/")
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": referer_url,
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
    }

    try:
        async with domain_sem:
            last_status = 0
            last_error = "Retries exhausted without a definitive response"

            for attempt in range(1, MAX_ATTEMPTS_PER_RUN + 1):
                try:
                    timeout = aiohttp.ClientTimeout(total=20, connect=10)
                    async with session.get(source_url, headers=headers, timeout=timeout) as res:
                        if res.status == 200:
                            raw_bytes = await res.read()
                            orig_size = len(raw_bytes)

                            if orig_size < 100:
                                await db.mark_failed_async(
                                    source_url, res.status, "Empty or invalid payload (<100 bytes)"
                                )
                                return

                            loop = asyncio.get_running_loop()
                            proc_bytes, sha256 = await loop.run_in_executor(
                                None, process_and_cloak_image_bytes, raw_bytes
                            )

                            success, result_url, up_status = await supabase.upload_object(
                                session, target_path, proc_bytes
                            )
                            if success:
                                await db.mark_completed_async(
                                    source_url, result_url, orig_size, len(proc_bytes), sha256
                                )
                            else:
                                # Terminal for this run: re-downloading the source to retry
                                # a storage-side failure only wastes origin bandwidth. The
                                # attempts counter lets a later run pick it up again.
                                await db.mark_failed_async(
                                    source_url, up_status, f"Supabase upload error: {result_url}"
                                )
                            return

                        if res.status in (404, 410):
                            await db.mark_failed_async(
                                source_url, res.status, "HTTP 404/410 Not Found on origin CDN"
                            )
                            return

                        if res.status in (429, 503, 504):
                            last_status = res.status
                            last_error = f"Rate limited / unavailable (HTTP {res.status})"
                            if attempt < MAX_ATTEMPTS_PER_RUN:
                                await asyncio.sleep(1.5 * attempt + random.uniform(0.2, 0.8))
                            continue

                        await db.mark_failed_async(source_url, res.status, f"HTTP error {res.status}")
                        return

                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    last_status = 0
                    last_error = f"Exception: {e}"
                    if attempt < MAX_ATTEMPTS_PER_RUN:
                        await asyncio.sleep(1.0 * attempt)

            # Every attempt was throttled or errored: record it so the task ages out
            # of the retry budget instead of sitting PENDING forever.
            await db.mark_failed_async(source_url, last_status, last_error)
    finally:
        pbar.update(1)


async def _queue_worker(
    queue: "asyncio.Queue",
    session: aiohttp.ClientSession,
    supabase: SupabaseStorageClient,
    db: SyncDatabase,
    domain_semaphores: Dict[str, asyncio.Semaphore],
    domain_limit: int,
    pbar: tqdm
):
    while True:
        task = await queue.get()
        try:
            if task is None:
                return
            await process_single_task(
                task, session, supabase, db, domain_semaphores, domain_limit, pbar
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"\n⚠️ Worker error on {task.get('source_url', '?')}: {e}")
        finally:
            queue.task_done()


def _run_catalog_linker():
    """Delegates to the linker so there is a single catalog-writing code path."""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    from link_supabase_catalog import link_catalog
    link_catalog(dry_run=False)


async def run_pipeline(limit: Optional[int] = None, concurrency: int = 25, update_catalog: bool = False):
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Error: Missing Supabase credentials in .env.local (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).")
        sys.exit(1)

    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("⚠️ SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key.")
        print("   Storage writes will fail unless the bucket has permissive write policies.")

    db = SyncDatabase(STATE_DB_PATH)
    supabase = SupabaseStorageClient(SUPABASE_URL, SUPABASE_KEY, BUCKET_NAME)

    # 1. Harvest & Register Tasks in Database
    stats = db.get_stats()
    if stats["total"] == 0:
        tasks = harvest_all_product_image_tasks()
        registered = db.register_tasks(tasks)
        print(f"📦 Registered {registered:,} initial tasks into SQLite state tracking.")
    else:
        print(f"📊 Resuming existing database state: {stats['completed']:,} completed, {stats['pending']:,} pending, {stats['failed']:,} failed.")

    pending_tasks = db.get_pending_tasks(limit=limit)
    if not pending_tasks:
        print("🎉 No pending image tasks to process! All tasks completed.")
        if update_catalog:
            _run_catalog_linker()
        return

    print(f"\n🚀 Launching async pipeline for {len(pending_tasks):,} pending images (Concurrency: {concurrency})...")

    # Per-origin throttles. Known CDNs are pre-seeded; anything else gets its own
    # semaphore on first use via get_domain_semaphore().
    domain_limit = max(1, min(12, concurrency))
    domain_sems: Dict[str, asyncio.Semaphore] = {
        "images-apmex.com": asyncio.Semaphore(domain_limit),
        "www.images-apmex.com": asyncio.Semaphore(domain_limit),
        "cdn.jmbullion.com": asyncio.Semaphore(domain_limit),
        "static.jmbullion.com": asyncio.Semaphore(domain_limit),
        "sdbullion.com": asyncio.Semaphore(domain_limit),
    }

    import ssl
    try:
        import certifi
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    connector = aiohttp.TCPConnector(ssl=ssl_ctx, limit=concurrency + 10, ttl_dns_cache=300)
    async with aiohttp.ClientSession(connector=connector) as session:
        # A missing or misconfigured bucket would otherwise surface as N individual
        # upload failures, so treat it as fatal up front.
        if not await supabase.ensure_bucket(session):
            print(f"❌ Aborting: Supabase bucket '{BUCKET_NAME}' is not available or not writable.")
            print("   Verify SUPABASE_SERVICE_ROLE_KEY and the bucket configuration, then re-run.")
            return

        with tqdm(total=len(pending_tasks), desc="Processing & Uploading", unit="img") as pbar:
            # Bounded queue + fixed worker pool. Scheduling all ~40k coroutines at
            # once gave no backpressure and no bound on in-flight work.
            queue: asyncio.Queue = asyncio.Queue(maxsize=concurrency * 4)
            workers = [
                asyncio.create_task(
                    _queue_worker(queue, session, supabase, db, domain_sems, domain_limit, pbar)
                )
                for _ in range(concurrency)
            ]
            try:
                for task in pending_tasks:
                    await queue.put(task)
                for _ in workers:
                    await queue.put(None)
                await asyncio.gather(*workers)
            except (KeyboardInterrupt, asyncio.CancelledError):
                print("\n⏹️  Interrupted — completed work is checkpointed, re-run to resume.")
                for w in workers:
                    w.cancel()
                await asyncio.gather(*workers, return_exceptions=True)
                raise

    # Final stats & export
    final_stats = db.get_stats()
    print("\n" + "="*50)
    print("🏁 PIPELINE RUN COMPLETED")
    print(f"  • Total Registered: {final_stats['total']:,}")
    print(f"  • Successfully Uploaded: {final_stats['completed']:,}")
    print(f"  • Pending/Remaining: {final_stats['pending']:,}")
    print(f"  • Failed/404s: {final_stats['failed']:,}")
    print(f"  • Total Storage Uploaded: {final_stats['total_mb_uploaded']:,} MB")
    print("="*50 + "\n")

    # Export mapping
    mapping = db.export_completed_mapping()
    with open(OUTPUT_MAPPING_PATH, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)
    print(f"💾 Exported latest Supabase URL mapping to {OUTPUT_MAPPING_PATH}")

    if update_catalog:
        _run_catalog_linker()


# --- 6. CLI INTERFACE ---
def main():
    parser = argparse.ArgumentParser(description="Rockwell Metals · Supabase Image Cloaking & Ingestion Pipeline")
    parser.add_argument("--inspect", "--dry-run", action="store_true", help="Harvest all links and print dataset summary without downloading.")
    parser.add_argument("--limit", type=int, default=None, help="Limit processing to first N images (useful for testing small batches).")
    parser.add_argument("--concurrency", type=int, default=25, help="Number of concurrent download/upload workers (default: 25).")
    parser.add_argument("--reset-db", action="store_true", help="Reset local SQLite checkpoint state database.")
    parser.add_argument("--update-catalog", action="store_true", help="Update app/data/products.json with new Supabase URLs after completion.")

    args = parser.parse_args()

    if args.reset_db and STATE_DB_PATH.exists():
        os.remove(STATE_DB_PATH)
        print(f"🗑️ Deleted state database {STATE_DB_PATH}")

    if args.inspect:
        print("=== INSPECTING CATALOG IMAGE POOL & SUPABASE CONNECTION ===")
        tasks = harvest_all_product_image_tasks()
        print(f"• Total Harvestable Tasks: {len(tasks):,}")
        
        domain_counts = defaultdict(int)
        view_counts = defaultdict(int)
        for t in tasks:
            d = urlparse(t["source_url"]).netloc
            domain_counts[d] += 1
            view_counts[t["view_type"]] += 1

        print("\n--- Tasks by Origin CDN ---")
        for d, cnt in sorted(domain_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"  • {d}: {cnt:,} images")

        print("\n--- Tasks by View Type ---")
        for v, cnt in sorted(view_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  • {v}: {cnt:,} images")

        db = SyncDatabase(STATE_DB_PATH)
        stats = db.get_stats()
        print(f"\n--- SQLite Database Status ({STATE_DB_PATH.name}) ---")
        print(f"  • Total in DB: {stats['total']:,}")
        print(f"  • Completed: {stats['completed']:,}")
        print(f"  • Pending: {stats['pending']:,}")
        print(f"  • Failed: {stats['failed']:,}")
        print(f"  • Bucket: '{BUCKET_NAME}' on {SUPABASE_URL}")
        print("\n✨ Ready to run when commanded! (Use --limit 10 to test or omit --inspect to run).")
        return

    # Run the async pipeline
    asyncio.run(run_pipeline(
        limit=args.limit,
        concurrency=args.concurrency,
        update_catalog=args.update_catalog
    ))


if __name__ == "__main__":
    main()
