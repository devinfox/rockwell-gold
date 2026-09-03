#!/usr/bin/env python3
"""
Renders Live_Pricing_Method_Explained.html -> Live_Pricing_Method_Explained.pdf

Unlike generate_pricing_doc_pdf.py (which embeds its markup inline), this reads the
HTML from disk so the document can be edited directly and re-rendered.
"""

from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
html_path = ROOT / "Live_Pricing_Method_Explained.html"
pdf_path = ROOT / "Live_Pricing_Method_Explained.pdf"

if not html_path.exists():
    raise SystemExit(f"Missing source HTML: {html_path}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(html_path.as_uri())
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)  # let webfonts settle
    page.pdf(
        path=str(pdf_path),
        format="Letter",
        print_background=True,
        margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"},
    )
    browser.close()

print(f"Successfully generated PDF: {pdf_path}")
