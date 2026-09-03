#!/usr/bin/env python3
"""
Rockwell Metals — Reusable Page Capture & Flow Generator Tool (Day Mode Standard)

Usage:
  # Capture a single page as customer in Day Mode:
  python3 scripts/capture.py /vault
  python3 scripts/capture.py /market/buffalo-1oz -o buffalo.png

  # Capture a page as admin:
  python3 scripts/capture.py /admin/orders --as admin -o admin-orders.png

  # Capture all pages across the app:
  python3 scripts/capture.py --all

  # Run the complete end-to-end journey and generate the Day Mode PDF report:
  python3 scripts/capture.py --flow --pdf
"""

import sys
import os
import time
import json
import argparse
import socket
from pathlib import Path
from playwright.sync_api import sync_playwright

# Preset user sessions
SESSIONS = {
    "customer": {
        "userId": "u-adrian",
        "name": "Adrian Reyes",
        "email": "customer@rockwell.demo",
        "role": "CUSTOMER"
    },
    "admin": {
        "userId": "s-admin",
        "name": "Victoria Cross",
        "email": "admin@rockwell.demo",
        "role": "SUPER_ADMIN"
    },
    "guest": None
}

def detect_port(preferred=(3002, 3000, 3001, 3003)):
    for p in preferred:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            if s.connect_ex(("127.0.0.1", p)) == 0:
                return p
    return 3002

def capture_single(url_or_path, output_path=None, role="customer", full_page=False, width=1440, height=900, port=None):
    if port is None:
        port = detect_port()
    
    base = f"http://localhost:{port}"
    if url_or_path.startswith("http"):
        url = url_or_path
    else:
        path = url_or_path if url_or_path.startswith("/") else f"/{url_or_path}"
        url = f"{base}{path}"

    if output_path is None:
        slug = url_or_path.strip("/").replace("/", "_").replace("?", "_").replace("=", "_") or "home"
        output_path = f"/tmp/rockwell_audit/{slug}.png"

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=2
        )
        page = context.new_page()

        # Inject session and enforce Day Mode
        page.goto(base)
        sess = SESSIONS.get(role.lower(), SESSIONS["customer"])
        page.evaluate(f"""() => {{
            localStorage.setItem('rm-theme', 'light');
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('rm-locks', JSON.stringify({{
                'RM-LCK-DEMO': {{
                    id: 'RM-LCK-DEMO',
                    productId: 'buffalo-1oz',
                    title: 'American Gold Buffalo · 1 oz',
                    sku: 'RM-AU-BUF-001',
                    image: '/assets/coin-buffalo.png',
                    mint: 'U.S. Mint',
                    unitPrice: 2559,
                    qty: 1,
                    spotAtLock: 2387.40,
                    createdAt: Date.now(),
                    expiresAt: Date.now() + 118000
                }}
            }}));
            {f"localStorage.setItem('rm-session', JSON.stringify({json.dumps(sess)}));" if sess else "localStorage.removeItem('rm-session');"}
        }}""")

        # Navigate to target
        page.goto(url, wait_until="networkidle", timeout=15000)
        page.evaluate("document.documentElement.setAttribute('data-theme', 'light');")
        page.wait_for_timeout(600)
        page.screenshot(path=output_path, full_page=full_page)
        browser.close()

    print(f"✓ Captured (Day Mode) [{role}] {url} -> {output_path}")
    return output_path

def main():
    parser = argparse.ArgumentParser(description="Rockwell Metals Screen Capture Tool (Day Mode)")
    parser.add_argument("path", nargs="?", default="/", help="Route or URL to capture (e.g. /vault, /admin/orders)")
    parser.add_argument("-o", "--out", help="Output PNG file path")
    parser.add_argument("--as", "--role", dest="role", default="customer", choices=["customer", "admin", "guest"], help="User role session")
    parser.add_argument("--full", action="store_true", help="Capture full scrollable page")
    parser.add_argument("--port", type=int, help="Override server port")
    parser.add_argument("--flow", action="store_true", help="Run the complete end-to-end flow")
    parser.add_argument("--pdf", action="store_true", help="Compile the captured flow into a PDF report")
    parser.add_argument("--all", action="store_true", help="Capture all 38 system pages")

    args = parser.parse_args()

    if args.flow or args.pdf:
        from generate_flow_pdf import run_flow
        run_flow(make_pdf=args.pdf, port=args.port)
        return

    if args.all:
        import scan_and_screenshot
        scan_and_screenshot.main()
        return

    capture_single(
        url_or_path=args.path,
        output_path=args.out,
        role=args.role,
        full_page=args.full,
        port=args.port
    )

if __name__ == "__main__":
    main()
