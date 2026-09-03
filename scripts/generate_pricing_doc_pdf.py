import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

html_content = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Live Pricing Method for Rockwell</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap');

  @page {
    size: letter;
    margin: 12mm 14mm 12mm 14mm;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 0;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1A1A1E;
    background-color: #FFFFFF;
    line-height: 1.4;
    font-size: 8.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .page-1 {
    page-break-after: always;
    break-after: page;
  }

  .page-2 {
    page-break-before: always;
    break-before: page;
  }

  /* Header */
  .header {
    border-bottom: 2px solid #D4AF4F;
    padding-bottom: 10px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .brand-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #FAF8F3;
    border: 1px solid #E6DEC9;
    padding: 3px 8px;
    border-radius: 5px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    font-weight: 700;
    color: #7A5E27;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }

  .brand-badge .dot {
    width: 6px;
    height: 6px;
    background: #1B9E57;
    border-radius: 50%;
  }

  .title {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 19pt;
    font-weight: 700;
    color: #111113;
    line-height: 1.1;
    margin: 0 0 3px 0;
    letter-spacing: -0.01em;
  }

  .subtitle {
    font-size: 8.5pt;
    color: #555760;
    margin: 0;
    font-weight: 400;
  }

  .doc-meta {
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7.2pt;
    color: #666872;
    line-height: 1.45;
  }

  .doc-meta strong {
    color: #111113;
  }

  /* Grids */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 9px;
    margin-bottom: 10px;
  }

  /* Cards */
  .card {
    background: #FAF8F5;
    border: 1px solid #ECE6D8;
    border-radius: 7px;
    padding: 9px 12px;
  }

  .card--gold {
    background: linear-gradient(135deg, #FCFAF5 0%, #F7EEDF 100%);
    border: 1px solid #D9C59A;
  }

  .card-title {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #7A5E27;
    margin-top: 0;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* Section Headings */
  .section-heading {
    font-size: 10.5pt;
    font-weight: 700;
    color: #111113;
    border-bottom: 1px solid #E6DEC9;
    padding-bottom: 4px;
    margin-top: 10px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-heading .tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 6.8pt;
    font-weight: 600;
    background: #EFE9D9;
    color: #634C1E;
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }

  /* Formula Banner */
  .formula-banner {
    background: #18191E;
    color: #FFFFFF;
    border-radius: 7px;
    padding: 10px 14px;
    margin: 8px 0 10px 0;
    border-left: 4px solid #D4AF4F;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .formula-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    color: #E5C365;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .formula-equation {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.8pt;
    font-weight: 600;
    color: #FFFFFF;
    letter-spacing: -0.01em;
  }

  .formula-equation .highlight {
    color: #F3D27C;
  }

  .formula-equation .plus {
    color: #8C8E98;
    margin: 0 3px;
  }

  .formula-explainer {
    font-size: 7.6pt;
    color: #A0A2AD;
    line-height: 1.35;
    margin: 0;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
    margin-bottom: 8px;
    font-size: 7.8pt;
  }

  th {
    background: #F2ECE0;
    color: #523E15;
    text-align: left;
    padding: 6px 8px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid #D9CEB8;
  }

  td {
    padding: 5.5px 8px;
    border-bottom: 1px solid #EBE7DE;
    color: #27282D;
    vertical-align: middle;
  }

  tr:nth-child(even) td {
    background: #FAF9F6;
  }

  .num {
    font-family: 'JetBrains Mono', monospace;
    font-variant-numeric: tabular-nums;
  }

  .pill {
    display: inline-block;
    padding: 1.5px 6px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 6.8pt;
    font-weight: 600;
  }

  .pill--gold {
    background: #F7EECD;
    color: #73551B;
    border: 1px solid #E0CE99;
  }

  .pill--green {
    background: #E2F5EA;
    color: #116B3B;
    border: 1px solid #B8E4CB;
  }

  .pill--blue {
    background: #E5EEFC;
    color: #1A54B8;
    border: 1px solid #C1D8F8;
  }

  /* Process Flow Steps */
  .flow-container {
    display: flex;
    gap: 7px;
    margin: 6px 0 10px 0;
  }

  .flow-step {
    flex: 1;
    background: #FAF8F4;
    border: 1px solid #E4DCC8;
    border-radius: 6px;
    padding: 7px 9px;
  }

  .flow-step-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: 6.8pt;
    font-weight: 700;
    color: #8C6A24;
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .flow-step-title {
    font-size: 8pt;
    font-weight: 700;
    color: #161618;
    margin-bottom: 3px;
  }

  .flow-step-desc {
    font-size: 7pt;
    color: #5C5E68;
    line-height: 1.3;
    margin: 0;
  }

  .page-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid #E6DEC9;
    padding-top: 6px;
    margin-top: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 6.8pt;
    color: #888A94;
  }
</style>
</head>
<body>

  <!-- ================= PAGE 1 ================= -->
  <div class="page page-1">
    <div>
      <div class="header">
        <div>
          <div class="brand-badge">
            <span class="dot"></span> Rockwell Metals · Institutional Standard
          </div>
          <h1 class="title">Live Pricing Method for Rockwell</h1>
          <p class="subtitle">How our catalog dynamically reprices 25,000+ coins in real-time, locks customer quotes, and guarantees margins.</p>
        </div>
        <div class="doc-meta">
          <strong>DATE:</strong> August 2026<br>
          <strong>SYSTEM:</strong> Rockwell Metals Platform<br>
          <strong>VERSION:</strong> 1.0 Production Architecture<br>
          <strong>PAGE:</strong> 01 of 02
        </div>
      </div>

      <!-- EXECUTIVE SUMMARY -->
      <div class="card card--gold" style="margin-bottom: 10px;">
        <div class="card-title">Executive Summary · The Big Picture</div>
        <p style="margin: 0; font-size: 8.2pt; line-height: 1.45; color: #2C2D33;">
          In precious metals, <strong>nobody manually changes price tags on thousands of items when gold moves</strong>. Instead, top market dealers like APMEX and JM Bullion connect a live market feed to stored commercial rules. Rockwell uses this exact model: whenever a customer views a coin, the system instantly computes its metal value at that current second and adds Rockwell’s commercial premium. The result is <strong>100% automated real-time pricing, zero manual overhead, and complete profit margin protection</strong> across all 25,000+ catalog products.
        </p>
      </div>

      <!-- THE FORMULA -->
      <div class="formula-banner">
        <div class="formula-label">The Universal Calculation-On-Read Formula</div>
        <div class="formula-equation">
          <span class="highlight">Customer Cash Price</span> = (<span class="highlight">Live Spot Ask</span> × <span class="highlight">Pure Troy Ounces</span>) <span class="plus">+</span> <span class="highlight">Rockwell Commercial Premium</span>
        </div>
        <p class="formula-explainer">
          Prices recalculate dynamically on request. We change one single live market number, and every coin across the entire store automatically updates to the penny.
        </p>
      </div>

      <!-- THE THREE PIECES -->
      <div class="section-heading">
        <span>1. The Three Components of Every Price</span>
        <span class="tag">Foundation</span>
      </div>

      <div class="grid-3">
        <div class="card">
          <div class="card-title">1. Live Metal Anchor</div>
          <p style="font-size: 7.5pt; color: #555760; margin: 0 0 6px 0;">The institutional market spot price per troy ounce updated continuously.</p>
          <div style="background: #FFF; border: 1px solid #E8E2D2; border-radius: 5px; padding: 4px 6px;" class="num">
            <span style="font-size: 7pt; color: #777;">Gold (XAU):</span> <strong style="font-size: 8pt; color: #111;">$2,400.00/oz</strong><br>
            <span style="font-size: 7pt; color: #777;">Silver (XAG):</span> <strong style="font-size: 8pt; color: #111;">$30.00/oz</strong>
          </div>
        </div>

        <div class="card">
          <div class="card-title">2. Pure Metal Weight</div>
          <p style="font-size: 7.5pt; color: #555760; margin: 0 0 6px 0;">The exact fine precious metal content contained in the physical coin or bar.</p>
          <div style="background: #FFF; border: 1px solid #E8E2D2; border-radius: 5px; padding: 4px 6px;" class="num">
            <span style="font-size: 7pt; color: #777;">1 oz Buffalo:</span> <strong style="font-size: 8pt; color: #111;">1.000 oz</strong><br>
            <span style="font-size: 7pt; color: #777;">1/2 oz Eagle:</span> <strong style="font-size: 8pt; color: #111;">0.500 oz</strong>
          </div>
        </div>

        <div class="card">
          <div class="card-title">3. Rockwell Premium</div>
          <p style="font-size: 7.5pt; color: #555760; margin: 0 0 6px 0;">Our commercial markup covering minting, fulfillment, and company profit.</p>
          <div style="background: #FFF; border: 1px solid #E8E2D2; border-radius: 5px; padding: 4px 6px;" class="num">
            <span style="font-size: 7pt; color: #777;">Standard Gold:</span> <strong style="font-size: 8pt; color: #7A5E27;">+5.5% over spot</strong><br>
            <span style="font-size: 7pt; color: #777;">100 oz Silver:</span> <strong style="font-size: 8pt; color: #7A5E27;">+$1.80/oz fixed</strong>
          </div>
        </div>
      </div>

      <!-- WORKED EXAMPLES TABLE -->
      <div class="section-heading">
        <span>2. Clear Product Pricing Examples in Action</span>
        <span class="tag">Real-World Math</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Product Category</th>
            <th>Physical Item</th>
            <th>Pure Weight</th>
            <th>Base Metal Value</th>
            <th>Rockwell Premium</th>
            <th>Final Cash Price</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1 oz Standard Gold</strong></td>
            <td>American Gold Buffalo</td>
            <td class="num">1.000 oz</td>
            <td class="num">$2,400.00</td>
            <td><span class="pill pill--gold">+5.5% ($132.00)</span></td>
            <td class="num"><strong>$2,532.00</strong></td>
          </tr>
          <tr>
            <td><strong>Fractional Gold</strong></td>
            <td>1/2 oz Gold Eagle</td>
            <td class="num">0.500 oz</td>
            <td class="num">$1,200.00</td>
            <td><span class="pill pill--gold">+7.5% ($90.00)</span></td>
            <td class="num"><strong>$1,290.00</strong></td>
          </tr>
          <tr>
            <td><strong>Bulk Silver Bar</strong></td>
            <td>100 oz Cast Silver Bar</td>
            <td class="num">100.00 oz</td>
            <td class="num">$3,000.00</td>
            <td><span class="pill pill--gold">+$1.80/oz ($180.00)</span></td>
            <td class="num"><strong>$3,180.00</strong></td>
          </tr>
          <tr>
            <td><strong>Collectible Gold</strong></td>
            <td>St. Helena Angel PF70</td>
            <td class="num">1.000 oz</td>
            <td class="num">$2,400.00</td>
            <td><span class="pill pill--blue">+$322.00 (Rare Coin)</span></td>
            <td class="num"><strong>$2,722.00</strong></td>
          </tr>
          <tr>
            <td><strong>Vault Buyback</strong></td>
            <td>Customer Selling 1 oz Gold</td>
            <td class="num">1.000 oz</td>
            <td class="num">$2,390.00 (Bid)</td>
            <td><span class="pill pill--green">-2.5% Spread</span></td>
            <td class="num"><strong>$2,330.25</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="page-footer">
      <div><strong>Rockwell Metals</strong> · Institutional Precious Metals Architecture</div>
      <div>Section 01 · Pricing Fundamentals</div>
    </div>
  </div>

  <!-- ================= PAGE 2 ================= -->
  <div class="page page-2">
    <div>
      <div class="header">
        <div>
          <div class="brand-badge">
            <span class="dot"></span> Rockwell Metals · Commercial Engine
          </div>
          <h2 class="title" style="font-size: 19pt;">Commercial Controls & Safety Guardrails</h2>
          <p class="subtitle">How Rockwell protects margins, rewards high-volume stackers, and manages payment rails.</p>
        </div>
        <div class="doc-meta">
          <strong>DATE:</strong> August 2026<br>
          <strong>SECTION:</strong> Operations & Governance<br>
          <strong>VERSION:</strong> 1.0 Production Architecture<br>
          <strong>PAGE:</strong> 02 of 02
        </div>
      </div>

      <!-- THE 4 COMMERCIAL LEVERS -->
      <div class="section-heading">
        <span>3. The Four Commercial Levers Controlled by Rockwell</span>
        <span class="tag">Merchant Power</span>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">A. Quantity Volume Ladders</div>
          <p style="font-size: 7.6pt; color: #444; margin: 0 0 5px 0;">
            Institutional stackers receive automated tiered discounts on higher quantities. The discount is deducted exclusively from the markup, never compromising base metal cost.
          </p>
          <div style="background: #FFF; border: 1px solid #E6E0D2; border-radius: 5px; padding: 4px 8px; font-size: 7.2pt;" class="num">
            • <strong>1–4 units:</strong> Full Retail Premium (+5.5%)<br>
            • <strong>5–19 units:</strong> 1.0% Premium Discount ($24/coin off)<br>
            • <strong>20+ units:</strong> 2.0% Premium Discount ($48/coin off)
          </div>
        </div>

        <div class="card">
          <div class="card-title">B. Payment Rail Matrix</div>
          <p style="font-size: 7.6pt; color: #444; margin: 0 0 5px 0;">
            Card and payment processing fees are transparently accounted for at checkout. Instant settlement methods enjoy cash-equivalent pricing without merchant fee penalties.
          </p>
          <div style="background: #FFF; border: 1px solid #E6E0D2; border-radius: 5px; padding: 4px 8px; font-size: 7.2pt;" class="num">
            • <strong>Crypto / USDC:</strong> 0.0% Surcharge (Best Cash Price)<br>
            • <strong>Fedwire / ACH:</strong> +0.4% Surcharge (Direct bank wire)<br>
            • <strong>Credit Card:</strong> +3.9% Surcharge (Card processing fee)
          </div>
        </div>

        <div class="card">
          <div class="card-title">C. Hard Margin Floor Protection</div>
          <p style="font-size: 7.6pt; color: #444; margin: 0 0 5px 0;">
            An unyielding automated safeguard built into the engine. Even after tier discounts, coupon codes, and rail adjustments, the system will never sell below a minimum gross margin.
          </p>
          <div style="background: #FFF; border: 1px solid #E6E0D2; border-radius: 5px; padding: 4px 8px; font-size: 7.2pt;" class="num">
            • <strong>Gold Floor:</strong> Minimum +1.5% over acquisition cost<br>
            • <strong>Silver Floor:</strong> Minimum +3.5% over acquisition cost
          </div>
        </div>

        <div class="card">
          <div class="card-title">D. Market Volatility Circuit Breaker</div>
          <p style="font-size: 7.6pt; color: #444; margin: 0 0 5px 0;">
            If spot market data spikes abnormally (e.g. >3.0% jump in under 60 seconds) or the feed drops offline, the system freezes quotes and switches to indicative safety marks.
          </p>
          <div style="background: #FFF; border: 1px solid #E6E0D2; border-radius: 5px; padding: 4px 8px; font-size: 7.2pt;" class="num">
            • <strong>Automated quote freeze</strong> during extreme volatility<br>
            • <strong>Zero risk</strong> of selling at obsolete or inaccurate spot prices
          </div>
        </div>
      </div>

      <!-- THE CUSTOMER JOURNEY -->
      <div class="section-heading">
        <span>4. The 120-Second Price Lock & Customer Journey</span>
        <span class="tag">Seamless Execution</span>
      </div>

      <div class="flow-container">
        <div class="flow-step">
          <div class="flow-step-num">Step 01</div>
          <div class="flow-step-title">Live Storefront</div>
          <p class="flow-step-desc">Customer browses 25,000+ items. Every price reflects the exact market spot of that second.</p>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">Step 02</div>
          <div class="flow-step-title">120s Price Freeze</div>
          <p class="flow-step-desc">Customer clicks "Buy Now". Price freezes for 2 minutes while selecting vaulting or delivery.</p>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">Step 03</div>
          <div class="flow-step-title">Multi-Rail Settle</div>
          <p class="flow-step-desc">Settlement via Crypto (0%), Wire (+0.4%), or Card (+3.9%) with transparent fee display.</p>
        </div>
        <div class="flow-step">
          <div class="flow-step-num">Step 04</div>
          <div class="flow-step-title">Vault Allocation</div>
          <p class="flow-step-desc">Order confirms. Metal exposure is hedged, serials allocated, and Vault Passport issued.</p>
        </div>
      </div>

      <!-- STRATEGIC ADVANTAGES -->
      <div class="section-heading">
        <span>5. Strategic Business Impact for Rockwell</span>
        <span class="tag">Competitive Edge</span>
      </div>

      <div class="grid-2">
        <div class="card card--gold">
          <div class="card-title">Zero Manual Workload</div>
          <p style="font-size: 7.6pt; color: #333; margin: 0; line-height: 1.4;">
            Whether gold moves $10 or $200 today, operations never touches a single product file. The entire catalog of 25,000+ items adjusts automatically in sub-milliseconds without server slowdowns.
          </p>
        </div>
        <div class="card card--gold">
          <div class="card-title">Parity with Industry Giants</div>
          <p style="font-size: 7.6pt; color: #333; margin: 0; line-height: 1.4;">
            Puts Rockwell on the exact same technological footing as APMEX and JM Bullion, giving customers institutional trust, real-time transparency, and seamless execution.
          </p>
        </div>
      </div>
    </div>

    <div class="page-footer">
      <div><strong>Rockwell Metals</strong> · Institutional Precious Metals Architecture</div>
      <div>Section 02 · Risk Controls & Governance · Confidential</div>
    </div>
  </div>

</body>
</html>
"""

# Write HTML file to disk
html_path = Path("/Users/devin/Desktop/Archive/Previous Desktop Cleanup (July 2026)/Projects/Folders/Archive/desktop-april/screenshot/DESKTOP 2026/projects/rockwell-gold/Live_Pricing_Method_Rockwell.html")
html_path.write_text(html_content, encoding="utf-8")
print(f"Wrote HTML to {html_path}")

# Generate PDF with Playwright
pdf_path = Path("/Users/devin/Desktop/Archive/Previous Desktop Cleanup (July 2026)/Projects/Folders/Archive/desktop-april/screenshot/DESKTOP 2026/projects/rockwell-gold/Live_Pricing_Method_Rockwell.pdf")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(f"file://{html_path.absolute()}")
    page.wait_for_load_state("networkidle")
    # Small pause to allow webfonts to load
    page.wait_for_timeout(1500)
    page.pdf(
        path=str(pdf_path),
        format="Letter",
        print_background=True,
        margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"}
    )
    browser.close()

print(f"Successfully generated PDF: {pdf_path}")
