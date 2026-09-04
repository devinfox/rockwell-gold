"use client";

import Link from "next/link";
import { useSpot, fmtSpot, fmtChange, spotDir, isIndicative } from "./use-spot";
import BrandLogo from "./brand-logo";

// Shared footer used by the catalog pages (matches the market page footer).
export default function SiteFooter() {
  const spot = useSpot();
  // Marks come from the shared /api/spot quote — never a literal — and are
  // flagged "indicative" whenever the feed is down or stale (audit: Medium).
  const indicative = isIndicative(spot);
  const tickers: { sym: string; label: string }[] = [
    { sym: "XAU", label: "Gold" },
    { sym: "XAG", label: "Silver" },
    { sym: "XPT", label: "Platinum" },
    { sym: "XAU", label: "Gold" },
  ];
  return (
    <footer className="footer">
      <div className="footer__ticker" aria-hidden="true">
        <div className="footer__track">
          {tickers.map((t, i) => (
            <span className="num" key={i}>
              {t.label} <b>{fmtSpot(spot, t.sym)}</b>{" "}
              {indicative ? (
                <i className="chg" data-dir="flat" style={{ color: "var(--text-muted)" }}>indicative</i>
              ) : (
                <i className="chg" data-dir={spotDir(spot, t.sym)}>{fmtChange(spot, t.sym)}</i>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="wrap footer__inner">
        <div className="footer__brand">
          <span className="footer__brand"><BrandLogo descriptor="METALS" size={28} /></span>
          <p className="footer__line">The hard asset, traded like a digital one.</p>
        </div>

        <nav className="footer__cols" aria-label="Footer">
          <div>
            <h4>Market</h4>
            <Link href="/gold">All gold</Link>
            <Link href="/drops">Drops &amp; auctions</Link>
            <Link href="/best-sellers">Best sellers</Link>
            <Link href="/new-arrivals">New arrivals</Link>
          </div>
          <div>
            <h4>Account</h4>
            <Link href="/auth/sign-in">Sign in</Link>
            <Link href="/auth/sign-up">Open account</Link>
            <Link href="/orders">Orders</Link>
            <Link href="/tax-center">Tax center</Link>
          </div>
          <div>
            <h4>Vault &amp; help</h4>
            <Link href="/vault">Your vault</Link>
            <Link href="/vault/sell-back">Sell back</Link>
            <Link href="/support">Support</Link>
            <Link href="/support/otc-desk">OTC desk</Link>
          </div>
        </nav>
      </div>

      <div className="wrap footer__legal">
        <span className="num">© 2026 Rockwell Metals</span>
        <span className="footer__legal-links">
          <Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/disclosures">Disclosures</Link>
        </span>
        <span className="footer__fine">
          {indicative ? "Spot marks shown are indicative — no live feed. " : "Prices indicative. "}Physical metal involves market risk.
        </span>
      </div>
    </footer>
  );
}
