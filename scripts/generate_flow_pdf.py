#!/usr/bin/env python3
"""
Rockwell Metals — End-to-End User & Operations Journey PDF Generator (Day Mode Standard)

Executes the customer and admin flows, captures high-resolution screenshots in Day Mode,
and compiles a multi-page PDF presentation.
"""

import sys
import os
import time
import json
import base64
import socket
from pathlib import Path
from playwright.sync_api import sync_playwright

FLOW_STEPS = [
    # ————— PART 1: CUSTOMER LIFECYCLE & TRADING JOURNEY —————
    {
        "id": "c01_signin",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "1. Access & Authentication",
        "route": "/auth/sign-in",
        "role": "guest",
        "desc": "Streamlined sign-in with email, passkey (Touch ID / Face ID), Google SSO, or hardware security key. Features value pillars: 100% allocated & segregated custody, 120s price lock guarantee, and armored delivery.",
        "highlights": [
            "Single primary gold action (Continue with Email)",
            "One-tap WebAuthn passkey verification",
            "Discreet staff portal link for operational security"
        ]
    },
    {
        "id": "c02_signup",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "2. Account Registration & Custody Charter",
        "route": "/auth/sign-up",
        "role": "guest",
        "desc": "Streamlined individual stacker account creation with legally binding segregated custody charter acceptance and instant onboarding.",
        "highlights": [
            "Individual Stacker direct bullion ownership model",
            "Zero custody fees in Year 1",
            "Direct AML/FinCEN compliance agreement"
        ]
    },
    {
        "id": "c03_kyc_verify",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "3. Automated Identity & KYC Verification",
        "route": "/auth/kyc-verification",
        "role": "customer",
        "desc": "Automated document scanning and 3D facial liveness verification that clears accounts to Tier 2 ($100,000 transaction limit) in under 60 seconds.",
        "highlights": [
            "Encrypted document verification",
            "Instant Tier 2 clearance for wire rails and insured delivery",
            "Human compliance escalation queue fallback"
        ]
    },
    {
        "id": "c04_kyc_status",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "4. Verification Clearance & Tier Permissions",
        "route": "/auth/kyc-status",
        "role": "customer",
        "desc": "Clear breakdown of active trading capabilities, transaction thresholds, and 2FA security status.",
        "highlights": [
            "Tier 2 clearance badge & active limits ($100,000)",
            "Instant permission checklist across wire, card, and delivery",
            "Direct institutional Tier 3 application pathway"
        ]
    },
    {
        "id": "c05_storefront",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "5. Storefront & Live Spot Ticker",
        "route": "/",
        "role": "customer",
        "desc": "Institutional-grade retail portal featuring sub-second live spot ticker (XAU, XAG, XPT), curated bullion drops, and real-time inventory float.",
        "highlights": [
            "Sub-second market ticker with percentage deltas",
            "Curated gold and silver bullion catalog",
            "Direct instant buy and serial verification tools in header"
        ]
    },
    {
        "id": "c06_market_floor",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "6. Market Floor Catalog & Live Spreads",
        "route": "/market",
        "role": "customer",
        "desc": "Full physical inventory catalog displaying live unit pricing, premium percentages over spot, mint origins, and real-time stock levels.",
        "highlights": [
            "Filterable by metal, mint, weight, and price",
            "Transparent premium breakdown over live spot",
            "Real-time available vault stock counts"
        ]
    },
    {
        "id": "c07_product_detail",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "7. Deep Product Assay & Price Freeze CTA",
        "route": "/market/buffalo-1oz",
        "role": "customer",
        "desc": "Product page featuring XRF spectrometer assay specifications, volume discount ladders, and the 120-second guaranteed price freeze trigger.",
        "highlights": [
            "Volume discount tiers (5–19: −1%, 20+: −2%)",
            "99.99% pure gold assay and dimensions specs",
            "Instant 120s price lock creation"
        ]
    },
    {
        "id": "c08_checkout",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "8. 120-Second Price Lock & Multi-Rail Settlement",
        "route": "/checkout/RM-LCK-DEMO",
        "role": "customer",
        "desc": "4-step settlement terminal: live countdown timer, custody choice (Allocated Vault vs. Armored Delivery), and multi-rail payment (Fedwire, Card).",
        "highlights": [
            "120s guaranteed price lock against live market ticks",
            "Cash-price Fedwire settlement instructions",
            "Free 1st-year allocated vault custody vs. discreet armored transit"
        ]
    },
    {
        "id": "c09_checkout_success",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "9. Settlement Receipt & Vault Passport Mint",
        "route": "/checkout/success/RM-ORD-1001",
        "role": "customer",
        "desc": "Cryptographic order receipt that instantly mints a serial-numbered Vault Passport with Lloyd's of London insurance certificate.",
        "highlights": [
            "Live minted Vault Passport with unique serials",
            "Automated Lloyd's of London policy assignment to $250M",
            "One-click routing to customer vault"
        ]
    },
    {
        "id": "c10_vault_portfolio",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "10. Vault Portfolio & Custody Management",
        "route": "/vault",
        "role": "customer",
        "desc": "Customer custody dashboard tracking physical allocated bullion holdings, real-time unrealized P/L, serial badges, and quick liquidity actions.",
        "highlights": [
            "Real-time mark-to-market portfolio valuation",
            "Segregated bay coordinates for every coin and bar",
            "1-click sell-back liquidity and armored withdrawal triggers"
        ]
    },
    {
        "id": "c11_vault_passport",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "11. Deep Serial Custody Passport",
        "route": "/vault/holdings/RM-AU-BUF-7741",
        "role": "customer",
        "desc": "Granular passport for a specific physical serial: XRF spectrometer purity reading, ultrasonic density scan, die-mark check, and chain of custody.",
        "highlights": [
            "Physical serial verification against master ledger",
            "Ultrasonic core density test verification",
            "Printable Lloyd's insurance certificate"
        ]
    },
    {
        "id": "c12_vault_sellback",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "12. Instant Sell-Back Liquidity Terminal",
        "route": "/vault/sell-back",
        "role": "customer",
        "desc": "Instant liquidation interface allowing customers to select vaulted pieces, lock a 90-second bid at a 0.5% spread, and receive a same-day Fedwire payout.",
        "highlights": [
            "Select All toggle across all vaulted holdings",
            "Instant 90-second live bid lock",
            "Pre-disbursement confirmation dialog with breakdown"
        ]
    },
    {
        "id": "c13_vault_delivery",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "13. Armored Physical Delivery Withdrawal",
        "route": "/vault/delivery",
        "role": "customer",
        "desc": "Armored withdrawal terminal allowing users to request physical delivery via Brink's Armored, FedEx Priority, or Malca-Amit with structured address validation.",
        "highlights": [
            "Structured multi-field delivery address inputs",
            "Armored carrier line selection",
            "Automatic tamper-evident barcode seal assignment"
        ]
    },
    {
        "id": "c14_vault_vaultplan",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "14. VaultPlan Automated DCA Engine",
        "route": "/vault/vaultplan",
        "role": "customer",
        "desc": "Dollar-cost averaging system for physical bullion. Automates weekly allocations with volume tier preservation and customizable investment sliders.",
        "highlights": [
            "Interactive weekly investment slider ($50 to $1,000/week)",
            "Automated Monday execution at live spot",
            "Volume tier retained across scheduled debits"
        ]
    },
    {
        "id": "c15_vault_rewards",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "15. Stacker Rewards & Volume Ladder",
        "route": "/vault/rewards",
        "role": "customer",
        "desc": "Lifetime volume tier progression (Stacker $\\rightarrow$ Guardian $\\rightarrow$ Sovereign $\\rightarrow$ Dynasty) offering contractual fee discounts and free armored deliveries.",
        "highlights": [
            "Real-time volume accumulation progress meter",
            "Contractual premium discount unlocks (up to 0.5%)",
            "Free annual armored shipping milestone"
        ]
    },
    {
        "id": "c16_orders_ledger",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "16. Customer Order Book & Status Filters",
        "route": "/orders",
        "role": "customer",
        "desc": "Complete chronological order ledger with real-time status tabs (All, Vaulted, Direct Delivery, In Transit) and search capabilities.",
        "highlights": [
            "One-click category filter tabs and search bar",
            "Status pills mapping full lifecycle transitions",
            "Direct link to fulfillment inspectors"
        ]
    },
    {
        "id": "c17_order_detail",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "17. Order Fulfillment Stepper",
        "route": "/orders/RM-ORD-1001",
        "role": "customer",
        "desc": "Detailed timeline of order state progression: Lock Initiated $\\rightarrow$ Paid $\\rightarrow$ In Assay $\\rightarrow$ Allocated $\\rightarrow$ Delivered.",
        "highlights": [
            "Visual milestone stepper with timestamps",
            "Itemized serials and settlement breakdown",
            "Direct link to live courier tracking"
        ]
    },
    {
        "id": "c18_armored_tracking",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "18. Live Armored Transit Tracking",
        "route": "/orders/tracking/RM-SHP-0207",
        "role": "customer",
        "desc": "Real-time armored logistics tracker displaying tamper-evident seal barcodes, custody transfer checkpoints, and direct signature requirements.",
        "highlights": [
            "Tamper-evident bag (TEB) seal barcode matching",
            "Brink's armored carrier route checkpoints",
            "Direct photo ID signature requirement"
        ]
    },
    {
        "id": "c19_tax_center",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "19. Tax Center & Form 8300 Compliance",
        "route": "/tax-center",
        "role": "customer",
        "desc": "Automated realized gains/loss ledger, 1099-B Schedule D exportable CSV reports, and FinCEN Form 8300 high-value transaction compliance monitoring.",
        "highlights": [
            "Yearly realized P/L calculations",
            "One-click Schedule D CSV report download",
            "Automated Form 8300 threshold monitoring ($10,000+)"
        ]
    },
    {
        "id": "c20_support",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "20. Concierge Support & Knowledge Base",
        "route": "/support",
        "role": "customer",
        "desc": "24/7 priority support concierge with interactive knowledge base, rapid ticket routing to staff desks, and OTC desk access.",
        "highlights": [
            "Interactive topic cards that pre-populate inquiry forms",
            "Staff median reply counter (11 minutes)",
            "Direct access to insurance claims and OTC desk"
        ]
    },
    {
        "id": "c21_support_ticket",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "21. Real-Time Ticket Communication Thread",
        "route": "/support/tickets/RM-TCK-0412",
        "role": "customer",
        "desc": "Two-way communication thread between customer and assigned support specialist with order linking and audit trail.",
        "highlights": [
            "Live synced conversation thread",
            "Order ID binding and priority indicator",
            "Staff verified identity markers"
        ]
    },
    {
        "id": "c22_drops",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "22. Drops Hub & Timed Allocations",
        "route": "/drops",
        "role": "customer",
        "desc": "Marketplace for rare proof sets, Dutch auctions, and limited batch allocations with live countdown clocks and supply meters.",
        "highlights": [
            "Live auction rooms with real-time bidding indicators",
            "Fixed-price timed batch allocations",
            "Scarcity meter showing remaining units in real-time"
        ]
    },
    {
        "id": "c23_drop_room",
        "part": "Part 1: Customer Lifecycle & Trading Journey",
        "title": "23. Live Auction Room & Anti-Snipe Ladder",
        "route": "/drops/drop-angel-x",
        "role": "customer",
        "desc": "Single auction room with real-time bid ladder, structured currency bid inputs, and automated 30-second anti-snipe extensions.",
        "highlights": [
            "Currency-prefixed bid entry with minimum increment logic",
            "Live bid ladder with pseudonymized bidder handles",
            "Automatic 30-second timer extension on last-second bids"
        ]
    },

    # ————— PART 2: STAFF & ADMIN OPERATIONS COMMAND —————
    {
        "id": "a01_admin_command",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "24. Operations Command Center",
        "route": "/admin",
        "role": "admin",
        "desc": "Master operational command hub displaying real-time unallocated float, pending wire receipts, fulfillment queues, and live system metrics.",
        "highlights": [
            "Live queue counters across OMS, Intake, and Transit",
            "Spot feed telemetry & market mark indicators",
            "Unified navigation across 12 operational subsystems"
        ]
    },
    {
        "id": "a02_admin_orders",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "25. Order Management System (OMS) Grid",
        "route": "/admin/orders",
        "role": "admin",
        "desc": "Centralized order book for staff with live status filtering, multi-field search (Customer, Order ID, SKU), and age tracking.",
        "highlights": [
            "Comprehensive order filtering across 8 lifecycle states",
            "Quick customer KYC tier indicators",
            "Direct navigation to deep order inspectors"
        ]
    },
    {
        "id": "a03_admin_order_inspector",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "26. Order Inspector & Wire Confirmation",
        "route": "/admin/orders/RM-ORD-1001",
        "role": "admin",
        "desc": "Deep order controller allowing staff to confirm wire receipts, route lots to assay, assign physical serials, and dispatch armored shipments with safeguard confirmations.",
        "highlights": [
            "Confirmation safeguards before executing state transitions",
            "Conditional packing slip generation for delivery orders",
            "Full Customer 360 profile summary"
        ]
    },
    {
        "id": "a04_admin_fulfillment",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "27. Pick / Pack / Ship Verification Station",
        "route": "/admin/fulfillment",
        "role": "admin",
        "desc": "Warehouse station for scanning serial numbers, applying tamper-evident bag (TEB) barcodes, and manifesting armored courier pickups.",
        "highlights": [
            "Barcode scan verification against order items",
            "Tamper seal recording and validation",
            "Armored courier line selection"
        ]
    },
    {
        "id": "a05_admin_shipments",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "28. Transit Control & Carrier Logistics",
        "route": "/admin/shipments",
        "role": "admin",
        "desc": "Master logistics console monitoring all active armored shipments in transit, delivery exceptions, and chain of custody verifications.",
        "highlights": [
            "Active shipment tracking across Brink's, FedEx, and Malca-Amit",
            "ETA and delivery status monitoring",
            "Direct manifest inspection"
        ]
    },
    {
        "id": "a06_admin_inventory",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "29. Master Vault Stock Registry",
        "route": "/admin/inventory",
        "role": "admin",
        "desc": "Comprehensive bullion float registry tracking verified inventory, customer-allocated ounces, unallocated float, and reorder trigger thresholds.",
        "highlights": [
            "Live float calculations (Total, Allocated, Free float)",
            "Automatic reorder threshold warnings",
            "Bay, shelf, and row physical coordinate tracking"
        ]
    },
    {
        "id": "a07_admin_intake",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "30. Mint Intake & XRF Spectrometer Logging",
        "route": "/admin/inventory/intake",
        "role": "admin",
        "desc": "Inbound intake terminal to register new mint deliveries, record XRF purity (90.00%–100.00% validation), log ultrasonic core tests, and spool serial tags.",
        "highlights": [
            "Enforced numerical XRF purity validation",
            "Ultrasonic core density test verification check",
            "Automatic vault bay assignment and barcode printing"
        ]
    },
    {
        "id": "a08_admin_allocate",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "31. Serial Number Allocation Station",
        "route": "/admin/inventory/allocate",
        "role": "admin",
        "desc": "Station for binding physical serial numbers from active vault inventory lots to customer orders upon payment verification.",
        "highlights": [
            "Lot float verification before allocation",
            "Unique serial generation and registry binding",
            "Instant customer vault balance updating"
        ]
    },
    {
        "id": "a09_admin_sellbacks",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "32. Inbound Liquidity Desk & Payouts",
        "route": "/admin/sell-backs",
        "role": "admin",
        "desc": "Treasury console reviewing customer sell-back requests, verifying KYC clearance, and executing 1-click Fedwire disbursements.",
        "highlights": [
            "1-click wire disbursement with confirmation modal",
            "Instant treasury stock reclamation upon payout",
            "KYC clearance status verification check"
        ]
    },
    {
        "id": "a10_admin_customers",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "33. Customer 360 CRM Directory",
        "role": "admin",
        "route": "/admin/customers",
        "desc": "Directory of all retail and institutional accounts with KYC tier levels, lifetime GMV, vaulted ounces, and risk ratings.",
        "highlights": [
            "Live GMV and vaulted ounce aggregations",
            "Risk rating indicators (Low / Medium / High)",
            "Account status and freeze indicators"
        ]
    },
    {
        "id": "a11_admin_customer_dossier",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "34. Customer Dossier & Risk Management",
        "route": "/admin/customers/u-adrian",
        "role": "admin",
        "desc": "Deep dossier view for individual clients: complete trade history, linked payment rails, staff notes, and account freeze overrides.",
        "highlights": [
            "Full order history and current vault holding inspection",
            "Immutable staff note append interface",
            "Emergency account freeze and unfreeze toggle"
        ]
    },
    {
        "id": "a12_admin_pricing_engine",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "35. Pricing Engine & Margin Controls",
        "route": "/admin/pricing-engine",
        "role": "admin",
        "desc": "Live pricing parameters: spot composite feed configuration, base metal markup percentages, volume discounts, payment surcharges, and sell-back spreads.",
        "highlights": [
            "Live metal premium basis controls (Gold, Silver, Platinum)",
            "Rail surcharge management (Wire, Card)",
            "Sell-back spread adjustments (0.50% default)"
        ]
    },
    {
        "id": "a13_admin_compliance",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "36. Compliance, AML & FinCEN 8300 Center",
        "route": "/admin/compliance",
        "role": "admin",
        "desc": "Compliance command center tracking FinCEN Form 8300 high-value transaction filings, OFAC sanctions checks, and manual KYC appeals.",
        "highlights": [
            "Automated Form 8300 trigger logs for transactions >$10,000",
            "Customer risk score monitoring",
            "1-click KYC tier promotion or document review"
        ]
    },
    {
        "id": "a14_admin_support",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "37. Staff Concierge & Ticket Queue",
        "route": "/admin/support",
        "role": "admin",
        "desc": "Staff ticket queue for customer inquiries, assay re-verifications, and delivery window coordination with SLA response counters.",
        "highlights": [
            "Ticket triage by priority (Urgent, High, Medium, Low)",
            "Direct thread replies synced to customer view",
            "Order linking for rapid dispute resolution"
        ]
    },
    {
        "id": "a15_admin_audit",
        "part": "Part 2: Staff & Admin Operations Command",
        "title": "38. Immutable Audit Ledger",
        "route": "/admin/audit-logs",
        "role": "admin",
        "desc": "Cryptographic, append-only operational audit log recording every system mutation with actor identity, timestamp, IP address, and before/after diffs.",
        "highlights": [
            "100% auditable log of all money and inventory movements",
            "Actor identity and IP geolocation recording",
            "State machine diff logging (before vs. after)"
        ]
    }
]

def detect_port():
    for p in (3002, 3000, 3001, 3003):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            if s.connect_ex(("127.0.0.1", p)) == 0:
                return p
    return 3002

def run_flow(make_pdf=True, port=None):
    if port is None:
        port = detect_port()
    base_url = f"http://localhost:{port}"
    img_dir = "/tmp/rockwell_flow_screens_day"
    os.makedirs(img_dir, exist_ok=True)
    pdf_out = os.path.abspath("Rockwell_Metals_Platform_Flow.pdf")

    print(f"=== Starting Rockwell Metals Journey Flow (Day Mode Standard) on {base_url} ===")
    print(f"Total Flow Steps to Capture: {len(FLOW_STEPS)}")

    customer_sess = {
        "userId": "u-adrian",
        "name": "Adrian Reyes",
        "email": "customer@rockwell.demo",
        "role": "CUSTOMER"
    }
    admin_sess = {
        "userId": "s-admin",
        "name": "Victoria Cross",
        "email": "admin@rockwell.demo",
        "role": "SUPER_ADMIN"
    }

    captured_items = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2
        )
        page = context.new_page()

        # Seed local storage initial state in Day Mode
        page.goto(base_url)
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
        }}""")

        for idx, step in enumerate(FLOW_STEPS, 1):
            target_url = f"{base_url}{step['route']}"
            sess = admin_sess if step["role"] == "admin" else (customer_sess if step["role"] == "customer" else None)
            
            # Switch session in localStorage and enforce Day Mode
            if sess:
                page.evaluate(f"""() => {{
                    localStorage.setItem('rm-theme', 'light');
                    document.documentElement.setAttribute('data-theme', 'light');
                    localStorage.setItem('rm-session', JSON.stringify({json.dumps(sess)}));
                }}""")
            else:
                page.evaluate("""() => {
                    localStorage.setItem('rm-theme', 'light');
                    document.documentElement.setAttribute('data-theme', 'light');
                    localStorage.removeItem('rm-session');
                }""")

            img_path = os.path.join(img_dir, f"{step['id']}.png")
            try:
                page.goto(target_url, wait_until="networkidle", timeout=15000)
                page.evaluate("document.documentElement.setAttribute('data-theme', 'light');")
                page.wait_for_timeout(600)
                page.screenshot(path=img_path)
                print(f"[{idx:02d}/{len(FLOW_STEPS):02d}] Captured (Day Mode): {step['title']} ({step['route']})")
                
                with open(img_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                
                captured_items.append({
                    **step,
                    "img_b64": f"data:image/png;base64,{b64}",
                    "img_path": img_path
                })
            except Exception as e:
                print(f"Error capturing {step['route']}: {e}")

        if make_pdf:
            print("\nCompiling Day Mode PDF presentation...")
            html_doc = build_html_report(captured_items)
            html_temp = "/tmp/rockwell_flow_report_day.html"
            with open(html_temp, "w", encoding="utf-8") as f:
                f.write(html_doc)
            
            pdf_page = context.new_page()
            pdf_page.goto(f"file://{html_temp}", wait_until="networkidle")
            pdf_page.pdf(
                path=pdf_out,
                format="A4",
                landscape=True,
                print_background=True,
                margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"}
            )
            print(f"✓ Day Mode PDF Generated Successfully: {pdf_out}")
            
            # Also save to docs directory
            docs_dir = os.path.abspath("docs")
            os.makedirs(docs_dir, exist_ok=True)
            docs_pdf = os.path.join(docs_dir, "Rockwell_Metals_Platform_Flow.pdf")
            with open(pdf_out, "rb") as src, open(docs_pdf, "wb") as dst:
                dst.write(src.read())
            print(f"✓ Copied PDF to docs directory: {docs_pdf}")

        browser.close()

    return pdf_out

def build_html_report(items):
    slides_html = []
    
    current_part = ""
    for idx, item in enumerate(items, 1):
        is_new_part = item["part"] != current_part
        if is_new_part:
            current_part = item["part"]
            part_divider = f"""
            <div class="part-slide">
                <div class="part-badge">ROCKWELL METALS ARCHITECTURE</div>
                <h1 class="part-title">{current_part}</h1>
                <p class="part-sub">End-to-end verified Day Mode workflow with live market marks, allocated physical custody, and atomic state machine transitions.</p>
            </div>
            """
            slides_html.append(part_divider)

        highlights_html = "".join([f"<li>{h}</li>" for h in item["highlights"]])
        role_badge = f'<span class="badge badge--{item["role"]}">{item["role"].upper()}</span>'

        slide = f"""
        <div class="flow-slide">
            <header class="slide-header">
                <div class="slide-header__left">
                    <span class="slide-num">STEP {idx:02d} OF {len(items):02d}</span>
                    <h2 class="slide-title">{item["title"]}</h2>
                </div>
                <div class="slide-header__right">
                    {role_badge}
                    <code class="slide-route">{item["route"]}</code>
                </div>
            </header>
            
            <div class="slide-body">
                <div class="slide-media">
                    <img src="{item['img_b64']}" alt="{item['title']}" />
                </div>
                <div class="slide-details">
                    <div class="detail-block">
                        <p class="detail-label">FUNCTIONAL OVERVIEW</p>
                        <p class="detail-text">{item["desc"]}</p>
                    </div>
                    <div class="detail-block" style="margin-top: 16px;">
                        <p class="detail-label">KEY ARCHITECTURAL HIGHLIGHTS</p>
                        <ul class="detail-list">
                            {highlights_html}
                        </ul>
                    </div>
                </div>
            </div>
            
            <footer class="slide-footer">
                <span>Rockwell Metals · Platform Flow &amp; User Journey (Day Mode)</span>
                <span>Role: <b>{item["role"].title()}</b> · Session: <b>{'customer@rockwell.demo' if item['role']=='customer' else ('admin@rockwell.demo' if item['role']=='admin' else 'Unauthenticated')}</b></span>
            </footer>
        </div>
        """
        slides_html.append(slide)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Rockwell Metals — Platform Flow &amp; Architecture (Day Mode)</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    
    body {{
        font-family: 'Space Grotesk', -apple-system, sans-serif;
        background: #F5F3ED;
        color: #1A1A1E;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }}
    
    code, .num {{
        font-family: 'JetBrains Mono', monospace;
    }}

    .cover-slide {{
        page-break-after: always;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 50px;
        background: radial-gradient(circle at top right, #FFFFFF 0%, #F5F3ED 70%);
        border: 1px solid #E4E0D6;
    }}
    
    .cover-badge {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        background: rgba(212, 175, 79, 0.16);
        border: 1px solid #8A6B2C;
        border-radius: 999px;
        color: #7A5E27;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        width: fit-content;
    }}
    
    .cover-main h1 {{
        font-size: 44px;
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1.1;
        margin: 16px 0 12px;
        color: #1A1A1E;
    }}
    
    .cover-main h1 span {{
        color: #7A5E27;
    }}
    
    .cover-main p {{
        font-size: 16px;
        color: #54555C;
        max-width: 680px;
        line-height: 1.5;
    }}
    
    .cover-roles {{
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-top: 30px;
    }}
    
    .role-card {{
        background: #FFFFFF;
        border: 1px solid #E4E0D6;
        border-radius: 12px;
        padding: 22px;
        box-shadow: 0 4px 12px rgba(107, 90, 46, 0.06);
    }}
    
    .role-card b {{
        color: #7A5E27;
        display: block;
        font-size: 16px;
        margin-bottom: 4px;
    }}
    
    .role-card code {{
        color: #1A1A1E;
        font-size: 13px;
        background: #EFEDE5;
        padding: 3px 8px;
        border-radius: 6px;
        font-weight: 600;
    }}
    
    .role-card p {{
        font-size: 13px;
        color: #54555C;
        margin-top: 10px;
        line-height: 1.45;
    }}

    .part-slide {{
        page-break-after: always;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 60px;
        background: #FFFFFF;
        border: 1px solid #E4E0D6;
    }}
    
    .part-badge {{
        color: #7A5E27;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        margin-bottom: 12px;
    }}
    
    .part-title {{
        font-size: 40px;
        font-weight: 700;
        color: #1A1A1E;
        margin-bottom: 12px;
        letter-spacing: -0.02em;
    }}
    
    .part-sub {{
        font-size: 16px;
        color: #54555C;
        max-width: 600px;
        line-height: 1.5;
    }}

    .flow-slide {{
        page-break-after: always;
        height: 100vh;
        display: flex;
        flex-direction: column;
        padding: 24px 30px;
        background: #F5F3ED;
        border-bottom: 1px solid #E4E0D6;
    }}
    
    .slide-header {{
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        padding-bottom: 12px;
        border-bottom: 1px solid #E4E0D6;
        margin-bottom: 14px;
    }}
    
    .slide-num {{
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        color: #7A5E27;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }}
    
    .slide-title {{
        font-size: 20px;
        font-weight: 600;
        color: #1A1A1E;
        margin-top: 2px;
    }}
    
    .slide-route {{
        background: #FFFFFF;
        border: 1px solid #E4E0D6;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        color: #7A5E27;
        font-weight: 600;
    }}
    
    .badge {{
        display: inline-block;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
        margin-right: 8px;
    }}
    .badge--customer {{ background: #1B9E57; color: #fff; }}
    .badge--admin {{ background: #D4AF4F; color: #1A1A1E; }}
    .badge--guest {{ background: #86878E; color: #fff; }}

    .slide-body {{
        display: grid;
        grid-template-columns: 1.75fr 1fr;
        gap: 20px;
        flex: 1;
        align-items: stretch;
    }}
    
    .slide-media {{
        background: #FFFFFF;
        border: 1px solid #E4E0D6;
        border-radius: 10px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
    }}
    
    .slide-media img {{
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
    }}
    
    .slide-details {{
        background: #FFFFFF;
        border: 1px solid #E4E0D6;
        border-radius: 10px;
        padding: 22px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
    }}
    
    .detail-label {{
        font-family: 'JetBrains Mono', monospace;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.12em;
        color: #7A5E27;
        margin-bottom: 6px;
    }}
    
    .detail-text {{
        font-size: 13.5px;
        color: #1A1A1E;
        line-height: 1.5;
    }}
    
    .detail-list {{
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 9px;
    }}
    
    .detail-list li {{
        position: relative;
        padding-left: 16px;
        font-size: 12.5px;
        color: #54555C;
        line-height: 1.45;
    }}
    
    .detail-list li::before {{
        content: "◆";
        position: absolute;
        left: 0;
        top: 2px;
        color: #7A5E27;
        font-size: 9px;
    }}
    
    .slide-footer {{
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 10px;
        border-top: 1px solid #E4E0D6;
        font-size: 11px;
        color: #86878E;
        margin-top: 10px;
    }}
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover-slide">
    <div>
        <div class="cover-badge">Rockwell Metals · Platform Architecture &amp; Complete Flow</div>
        <div class="cover-main">
            <h1>Physical Bullion, <span>Traded Like Digital</span></h1>
            <p>A complete Day Mode visual walkthrough of the customer onboarding, trading, allocated custody, and staff operations lifecycle across all 38 verified screens.</p>
        </div>
    </div>
    
    <div class="cover-roles">
        <div class="role-card">
            <b>1. Customer User Journey</b>
            <code>customer@rockwell.demo</code>
            <p>Experience full customer trading: market catalog, 120s price lock checkout, wire &amp; card settlement, live Vault Passport minting, allocated holding management, instant sell-back liquidity, and armored withdrawal tracking.</p>
        </div>
        <div class="role-card">
            <b>2. Staff Operations Command</b>
            <code>admin@rockwell.demo</code>
            <p>Experience the operational backend: OMS order processing, mint intake with XRF spectrometer purity validation, serial allocation, sell-back liquidation payout desk, Customer 360 CRM, and immutable cryptographic audit logs.</p>
        </div>
    </div>
    
    <div style="display: flex; justify-content: space-between; font-size: 12px; color: #86878E; border-top: 1px solid #E4E0D6; padding-top: 14px;">
        <span>Rockwell Metals Inc. · High-Value Bullion Exchange</span>
        <span>Standard Day Mode · Confidential &amp; Proprietary</span>
    </div>
</div>

<!-- SLIDES -->
{''.join(slides_html)}

</body>
</html>
"""

if __name__ == "__main__":
    run_flow(make_pdf=True)
