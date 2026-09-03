#!/usr/bin/env python3
"""
Rockwell Metals · one-off image cloaking (same treatment as rockwell_image_pipeline.py)

  python3 scripts/cloak_images.py --product <catalog id>   # fetch the product's current
                                                           # source image, cloak, upload to the
                                                           # rockwell-products bucket, relink
                                                           # products.json and the sync DB
  python3 scripts/cloak_images.py --assets                 # cloak public/assets/coin-*.png in place
                                                           # (originals backed up to reference_original/)

Cloaking = EXIF/XMP/IPTC/ICC stripped, +1.1–1.4% brightness and +1.4–1.8%
contrast micro-jitter (invisible, breaks pHash/dHash and every checksum), then a
clean re-encode. Products become WebP q92 like the rest of the catalog;
prototype PNGs stay PNG so nothing that references them changes.
"""

import argparse, hashlib, io, json, os, random, re, sqlite3, subprocess, sys, tempfile, urllib.parse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS = ROOT / "app" / "data" / "products.json"
STATE_DB = ROOT / "data" / "rockwell_image_sync_state.db"
ASSETS = ROOT / "public" / "assets"
BACKUP = ROOT / "reference_original" / "assets"
BUCKET = "rockwell-products"


def env():
    vals = {}
    for line in (ROOT / ".env.local").read_text().splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if m and not line.strip().startswith("#"):
            vals[m.group(1)] = m.group(2).strip('"').strip("'")
    return vals


def slugify(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[-\s]+", "-", text).strip("-")[:80]


def cloak(raw: bytes, fmt: str) -> bytes:
    with Image.open(io.BytesIO(raw)) as img:
        was_palette = img.mode == "P" or img.getcolors(256) is not None
        img = ImageOps.exif_transpose(img)
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        if fmt == "WEBP":
            if has_alpha:
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img.convert("RGB"), mask=img.convert("RGBA").split()[-1])
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")
        else:
            img = img.convert("RGBA" if has_alpha else "RGB")
        b = round(random.uniform(1.011, 1.014), 4)
        c = round(random.uniform(1.014, 1.018), 4)
        if img.mode == "RGBA":
            # Jitter only the visible pixels. Fully transparent pixels keep
            # their original RGB, otherwise the enhancer turns a flat
            # transparent canvas into noise and the PNG grows ~8×.
            original = img
            rgb, a = img.convert("RGB"), img.split()[-1]
            rgb = ImageEnhance.Contrast(ImageEnhance.Brightness(rgb).enhance(b)).enhance(c)
            jittered = rgb.convert("RGBA")
            jittered.putalpha(a)
            visible = a.point(lambda v: 255 if v > 0 else 0)
            img = Image.composite(jittered, original, visible)
        else:
            img = ImageEnhance.Contrast(ImageEnhance.Brightness(img).enhance(b)).enhance(c)
        out = io.BytesIO()
        # A fresh Image object carries no EXIF/XMP/ICC; PIL writes none unless asked.
        if fmt == "WEBP":
            img.save(out, format="WEBP", quality=92, method=4, lossless=False, exact=False)
        else:
            # Keep the file size in the same class as the source: a palette PNG
            # stays a palette PNG (the jitter has already made every pixel unique).
            if was_palette:
                img = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
            img.save(out, format="PNG", optimize=True)
        return out.getvalue()


def curl(args, data: bytes | None = None) -> tuple[int, bytes, str]:
    """HTTP via curl: the python.org interpreter on this Mac ships without a CA bundle."""
    cmd = ["curl", "-sS", "-L", "--max-time", "60", "-o", "-", "-w", "\n%{http_code}\n%{content_type}"]
    tmp = None
    if data is not None:
        tmp = tempfile.NamedTemporaryFile(delete=False); tmp.write(data); tmp.close()
        cmd += ["--data-binary", "@" + tmp.name]
    out = subprocess.run(cmd + args, capture_output=True, check=False)
    if tmp: os.unlink(tmp.name)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.decode(errors="replace").strip())
    body, code, ctype = out.stdout.rsplit(b"\n", 2)
    return int(code), body, ctype.decode().strip()


def fetch(url: str) -> bytes:
    host = urllib.parse.urlparse(url).netloc
    code, body, _ = curl([
        "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
        "-H", "Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8", "-H", f"Referer: https://{host}/", url])
    if code != 200:
        raise RuntimeError(f"fetch {url} → {code}")
    return body


def upload(path: str, data: bytes, e: dict) -> str:
    base = e["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    code, body, _ = curl(["-X", "POST", "-H", f"Authorization: Bearer {e['SUPABASE_SERVICE_ROLE_KEY']}", "-H", f"apiKey: {e['SUPABASE_SERVICE_ROLE_KEY']}",
                          "-H", "Content-Type: image/webp", "-H", "x-upsert: true", "-H", "Cache-Control: public, max-age=31536000, immutable",
                          f"{base}/storage/v1/object/{BUCKET}/{path}"], data)
    if code not in (200, 201):
        raise RuntimeError(f"upload {code}: {body[:200]!r}")
    return f"{base}/storage/v1/object/public/{BUCKET}/{path}"


def do_product(pid: str):
    e = env()
    products = json.loads(PRODUCTS.read_text())
    p = next((x for x in products if x["id"] == pid), None)
    if not p:
        sys.exit(f"no product {pid}")
    src = p["image"]
    if "supabase.co" in src:
        print(f"{pid} already on the bucket: {src}")
        return
    raw = fetch(src)
    if len(raw) < 100:
        sys.exit("empty source image")
    out = cloak(raw, "WEBP")
    sha = hashlib.sha256(out).hexdigest()
    path = f"products/{slugify(p['sku'])}/primary_{hashlib.sha256(src.encode()).hexdigest()[:10]}.webp"
    public = upload(path, out, e)
    # verify it serves
    code, _, ctype = curl([public])
    assert code == 200 and ctype.startswith("image/"), f"public url not serving ({code} {ctype})"
    p["image"] = public
    if p.get("images"):
        p["images"] = [public if u == src else u for u in p["images"]]
    PRODUCTS.write_text(json.dumps(products, indent=2) + "\n")
    if STATE_DB.exists():
        c = sqlite3.connect(STATE_DB)
        c.execute("""INSERT INTO image_tasks (source_url, product_sku, product_id, view_type, target_path, supabase_url, status, original_size_bytes, processed_size_bytes, sha256_hash, attempts, updated_at)
                     VALUES (?,?,?,?,?,?,'COMPLETED',?,?,?,1,CURRENT_TIMESTAMP)
                     ON CONFLICT(source_url) DO UPDATE SET status='COMPLETED', supabase_url=excluded.supabase_url,
                       original_size_bytes=excluded.original_size_bytes, processed_size_bytes=excluded.processed_size_bytes,
                       sha256_hash=excluded.sha256_hash, error_message=NULL, updated_at=CURRENT_TIMESTAMP""",
                  (src, p["sku"], pid, "primary", path, public, len(raw), len(out), sha))
        c.commit()
    print(f"{pid} {p['title']}\n  source  {len(raw)/1024:.1f} KB  sha256 {hashlib.sha256(raw).hexdigest()[:16]}…\n  cloaked {len(out)/1024:.1f} KB  sha256 {sha[:16]}…\n  → {public}")


def do_assets():
    BACKUP.mkdir(parents=True, exist_ok=True)
    for f in sorted(ASSETS.glob("coin-*.png")):
        raw = f.read_bytes()
        bak = BACKUP / f.name
        if not bak.exists():
            bak.write_bytes(raw)
        out = cloak(raw, "PNG")
        f.write_bytes(out)
        print(f"{f.name:22s} {len(raw)/1024:7.1f} KB → {len(out)/1024:7.1f} KB   {hashlib.sha256(raw).hexdigest()[:12]}… → {hashlib.sha256(out).hexdigest()[:12]}…")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--product")
    ap.add_argument("--assets", action="store_true")
    a = ap.parse_args()
    if a.product:
        do_product(a.product)
    if a.assets:
        do_assets()
    if not a.product and not a.assets:
        ap.print_help()
