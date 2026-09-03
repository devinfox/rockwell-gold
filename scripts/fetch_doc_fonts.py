#!/usr/bin/env python3
"""
Builds STATIC, FULL-COVERAGE TrueType fonts for the Rockwell PDF documents into fonts/.

Why this exists — two separate bugs it fixes:

1. Type 3 fonts / broken text selection.
   The docs originally pulled fonts via @import from the Google Fonts CSS v2 API,
   which serves *variable* woff2. Chromium's PDF writer cannot embed a variable-font
   instance as a real font program, so it rasterised every face into a Type 3 font.
   Type 3 text is not properly selectable: copying out of the PDF produced broken
   words ("num b er", "we 're"). Instancing the variable font to a fixed weight
   here gives Chromium a normal static TTF it embeds natively.

2. Missing glyphs / fallback fonts.
   The Google Fonts CSS APIs serve latin-SUBSET files, which omit U+2192 (arrow)
   among others. Chromium silently fell back to Menlo and PingFang SC for those,
   mixing unrelated typefaces into the document. The upstream google/fonts sources
   used here are unsubsetted, so the whole document renders in-family.

Run this once; fonts/ is then reused by the document generators.
"""

import pathlib
import subprocess
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts"
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl"

# (upstream variable font, output basename, {suffix: weight})
SOURCES = [
    (f"{BASE}/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf",
     "PlusJakartaSans", {"400": 400, "700": 700}),
    (f"{BASE}/plusjakartasans/PlusJakartaSans-Italic%5Bwght%5D.ttf",
     "PlusJakartaSans", {"400i": 400}),
    (f"{BASE}/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
     "JetBrainsMono", {"400": 400, "600": 600, "700": 700}),
    (f"{BASE}/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf",
     "PlayfairDisplay", {"700": 700}),
]

# Every non-ASCII character the documents rely on. Verified after instancing so a
# silent fallback to Menlo/PingFang can never reappear unnoticed.
REQUIRED = "·×—–½→“”‘’"


def curl(url: str) -> bytes:
    r = subprocess.run(["curl", "-sSL", "--max-time", "60", url], capture_output=True)
    if r.returncode != 0:
        sys.exit(f"curl failed for {url}: {r.stderr.decode()[:300]}")
    return r.stdout


def main() -> None:
    OUT.mkdir(exist_ok=True)
    built = []

    for url, base, weights in SOURCES:
        src = OUT / f".{base}-src.ttf"
        src.write_bytes(curl(url))

        for suffix, wght in weights.items():
            font = TTFont(src)
            if "fvar" not in font:
                sys.exit(f"{url} is not a variable font; cannot instance")
            instancer.instantiateVariableFont(font, {"wght": wght}, inplace=True)

            missing = [c for c in REQUIRED if ord(c) not in font.getBestCmap()]
            if missing:
                sys.exit(f"{base}-{suffix} is missing glyphs: {' '.join(missing)}")

            dest = OUT / f"{base}-{suffix}.ttf"
            font.save(dest)
            font.close()
            built.append(dest)
            print(f"  {dest.name:<28} wght {wght:<4} {dest.stat().st_size // 1024:>4} KB")

        src.unlink()

    print(f"\n{len(built)} static TTFs -> {OUT}")


if __name__ == "__main__":
    main()
