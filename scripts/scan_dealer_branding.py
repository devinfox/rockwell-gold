#!/usr/bin/env python3
"""
Rockwell Metals · Dealer-branding image audit
=============================================
Sends every live product image (app/data/products.json) to Claude and asks
whether the photo shows third-party dealer branding (APMEX logo / wordmark,
MintDirect tubes, dealer labels, watermarks, frames, other retailer names).

Results are written incrementally to a JSON file keyed by image URL so the
scan can be resumed. Grading-service holders (PCGS/NGC) and mint-issued
packaging are deliberately NOT flagged.

Usage:
  python3 scripts/scan_dealer_branding.py --out data/dealer_branding_scan.json
  python3 scripts/scan_dealer_branding.py --urls url1 url2 ...   # ad-hoc check
"""

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError, RateLimitError
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
for env in (ROOT / ".env.local", ROOT.parent / "crm" / ".env.local"):
    if env.exists():
        load_dotenv(env)

MODEL = "claude-opus-5"

SYSTEM = """You audit product photographs for a precious-metals retailer that must not show any other dealer's branding.

Flag an image (branded=true) if it shows ANY of:
- The word APMEX, the APMEX logo, or "MintDirect" / "MintDirect Premier" in any form
- Dealer-branded tubes, boxes, sleeves, cards, labels, or stickers (APMEX, JM Bullion, SD Bullion, Provident, Money Metals, Silver.com, or any other retailer)
- A dealer watermark, dealer URL, or dealer frame/border around the photo
- Any other retailer's name or logo

Do NOT flag:
- Grading-service holders and labels (PCGS, NGC, ANACS, CAC), including their special labels such as First Strike, First Day of Issue, anniversary labels
- Packaging issued by the mint itself (U.S. Mint monster boxes and tubes, Royal Canadian Mint boxes, Perth Mint cards, PAMP / Valcambi / Argor-Heraeus assay cards, Royal Mint packaging)
- Text that is part of the coin or bar design itself
- Plain capsules, plain flips, plain tubes with no dealer marking

Reply with JSON only, no prose:
{"branded": true|false, "kind": "logo"|"packaging"|"watermark"|"frame"|"other"|"none", "evidence": "<one short sentence describing what you see>"}"""


def parse_verdict(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {"branded": None, "kind": "error", "evidence": f"unparseable: {text[:120]}"}
    try:
        d = json.loads(m.group(0))
        return {"branded": bool(d.get("branded")), "kind": d.get("kind", "none"), "evidence": d.get("evidence", "")}
    except json.JSONDecodeError:
        return {"branded": None, "kind": "error", "evidence": f"bad json: {text[:120]}"}


async def classify(client: AsyncAnthropic, url: str, sem: asyncio.Semaphore, image_bytes: bytes | None = None, media_type: str = "image/webp") -> dict:
    """Classify an image by public URL, or by raw bytes when image_bytes is given (url is then just a label)."""
    if image_bytes is not None:
        import base64
        source = {"type": "base64", "media_type": media_type, "data": base64.b64encode(image_bytes).decode("ascii")}
    else:
        source = {"type": "url", "url": url}
    async with sem:
        for attempt in range(4):
            try:
                resp = await client.beta.messages.create(
                    model=MODEL,
                    max_tokens=300,
                    system=SYSTEM,
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    output_config={"effort": "medium"},
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": source},
                            {"type": "text", "text": "Audit this product photo for dealer branding."},
                        ],
                    }],
                )
                if resp.stop_reason == "refusal":
                    return {"branded": None, "kind": "refusal", "evidence": "model refused"}
                text = "".join(b.text for b in resp.content if b.type == "text")
                return parse_verdict(text)
            except RateLimitError:
                await asyncio.sleep(3 * (attempt + 1))
            except (APIConnectionError, APIStatusError) as e:
                if attempt == 3:
                    return {"branded": None, "kind": "error", "evidence": f"{type(e).__name__}: {str(e)[:120]}"}
                await asyncio.sleep(2 * (attempt + 1))
        return {"branded": None, "kind": "error", "evidence": "rate limited repeatedly"}


async def run(urls: list[str], out: Path | None, concurrency: int) -> dict:
    results: dict = {}
    if out and out.exists():
        results = json.loads(out.read_text())
    todo = [u for u in urls if u not in results or results[u].get("branded") is None]
    print(f"{len(urls)} images · {len(urls) - len(todo)} already scanned · {len(todo)} to scan", flush=True)

    client = AsyncAnthropic()
    sem = asyncio.Semaphore(concurrency)
    done = 0
    lock = asyncio.Lock()

    async def one(u: str):
        nonlocal done
        r = await classify(client, u, sem)
        async with lock:
            results[u] = r
            done += 1
            if out and (done % 25 == 0 or done == len(todo)):
                out.write_text(json.dumps(results, indent=1))
            if done % 50 == 0 or done == len(todo):
                flagged = sum(1 for v in results.values() if v.get("branded"))
                print(f"  {done}/{len(todo)} scanned · {flagged} flagged so far", flush=True)

    await asyncio.gather(*(one(u) for u in todo))
    if out:
        out.write_text(json.dumps(results, indent=1))
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "dealer_branding_scan.json")
    ap.add_argument("--urls", nargs="*", help="Scan these URLs instead of the live catalog")
    ap.add_argument("--concurrency", type=int, default=8)
    args = ap.parse_args()

    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    if args.urls:
        res = asyncio.run(run(args.urls, None, args.concurrency))
        for u, r in res.items():
            print(json.dumps({"url": u.rsplit("/", 1)[-1], **r}))
        return

    products = json.loads((ROOT / "app" / "data" / "products.json").read_text())
    urls = list(dict.fromkeys(p["image"] for p in products if p.get("image")))
    res = asyncio.run(run(urls, args.out, args.concurrency))
    flagged = [u for u, r in res.items() if r.get("branded")]
    errors = [u for u, r in res.items() if r.get("branded") is None]
    print(f"\nflagged: {len(flagged)} · errors: {len(errors)} · saved to {args.out}")


if __name__ == "__main__":
    main()
