"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import SiteNav from "./components/site-nav";
import { initHome } from "./lib/home";
import { useFintech } from "./components/global-fintech-provider";
import { useSpot, fmtSpot, fmtChange, spotDir } from "./components/use-spot";
import BrandLogo from "./components/brand-logo";

export default function HomeClient() {
  const { openCheckout, openVerifySerial, openPriceAlert, addToast } = useFintech();
  const spot = useSpot();

  useEffect(() => {
    const cleanup = initHome();
    return cleanup;
  }, []);

  return (
    <>
      {/* nav */}
      <SiteNav />

      <main>
        {/* hero */}
        <section className="hero">
          <div className="wrap hero__inner">
            <div className="hero__copy">
              <p className="eyebrow">
                <span className="eyebrow__dot" aria-hidden="true"></span> Live market · physical gold
              </p>
              <h1 className="hero__title">The hard asset, traded&nbsp;like a digital&nbsp;one.</h1>
              <p className="hero__sub">
                Buy verified physical gold — coins, bars, and rare collectibles — priced against the live market, authenticated by assay, and held in secure custody or shipped to your door.
              </p>
              <div className="hero__cta">
                <a className="btn btn--gold btn--lg" href="#pulse">
                  Enter live market
                </a>
                <a className="btn btn--ghost btn--lg" href="#drops">
                  View active drops
                </a>
              </div>

              {/* inline stat row */}
              <dl className="hero__stats">
                <div className="stat">
                  <dt>{spot?.live ? "Live spot" : "Spot (indicative)"}</dt>
                  <dd className="num">{fmtSpot(spot, "XAU")}</dd>
                </div>
                <div className="stat">
                  <dt>24h move</dt>
                  <dd className="num chg" data-dir={spotDir(spot, "XAU")}>
                    {fmtChange(spot, "XAU") || "—"}
                  </dd>
                </div>
                <div className="stat">
                  <dt>Inventory verified</dt>
                  <dd className="num">12,480 oz</dd>
                </div>
                <div className="stat">
                  <dt>Last sync</dt>
                  <dd className="num" data-sync>
                    4s ago
                  </dd>
                </div>
              </dl>
            </div>

            <div
              className="hero__art"
              aria-hidden="false"
              style={{ cursor: "pointer" }}
              onClick={() =>
                openCheckout({
                  id: "561",
                  title: "American Gold Buffalo · 1 oz",
                  price: parseFloat(document.querySelector("[data-hero-price]")?.getAttribute("data-value") ?? "") || 0,
                  mint: "U.S. Mint",
                  image: "/assets/coin-buffalo.png",
                })
              }
              title="Click for instant 120s price lock"
            >
              <div className="hero__halo"></div>
              <img
                className="hero__coin"
                src="/assets/coin-buffalo.png"
                alt="1 oz Gold Buffalo coin, obverse"
              />
              <span className="hero__chip num">
                <span className="hero__chip-k">99.99</span> fine · 1 oz
              </span>
              <div className="hero__badge num">
                <span className="hero__badge-dot" aria-hidden="true"></span>
                <span><span data-hero-price="561" data-value="">—</span> · 120s price lock</span>
              </div>
            </div>
          </div>
        </section>

        {/* market pulse — bento grid */}
        <section className="section section--bento" id="pulse">
          <div className="wrap">
            <div className="section__head">
              <div>
                <span className="section__index num">01 / Market Pulse</span>
                <p className="eyebrow">
                  <span className="eyebrow__dot" aria-hidden="true"></span> Global liquidity
                </p>
                <h2 className="section__title">Trading floor</h2>
                <p className="section__sub">
                  Live spot correlations, 24-hour volume flows, and real-time execution across sovereign bullion.
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn--ghost num"
                  style={{ fontSize: "12px", padding: "6px 12px" }}
                  onClick={() => openPriceAlert("XAU/USD", Math.round(spot?.prices?.XAU ?? 0))}
                >
                  🔔 Set Spot Alert
                </button>
                <a className="section__more" href="/market">
                  Open market floor →
                </a>
              </div>
            </div>

            {/* bento layout */}
            <div className="bento">
              {/* main interactive chart */}
              <article className="card bento__chart">
                <header className="chart__head">
                  <div>
                    <p className="chart__pair num">
                      <span className="spot__dot" aria-hidden="true"></span> XAU/USD · Gold Spot
                    </p>
                    <div className="chart__price">
                      <span className="num">{fmtSpot(spot, "XAU")}</span>
                      <span className="num chg" data-dir={spotDir(spot, "XAU")}>
                        {fmtChange(spot, "XAU") || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="ranges" role="group" aria-label="Timeframe">
                    <button className="range range--on" data-range="1D" aria-pressed="true">1D</button>
                    <button className="range" data-range="1W" aria-pressed="false">1W</button>
                    <button className="range" data-range="1M" aria-pressed="false">1M</button>
                    <button className="range" data-range="ALL" aria-pressed="false">ALL</button>
                  </div>
                </header>
                <div className="chart__plot">
                  <svg
                    className="chart__svg"
                    data-chart=""
                    viewBox="0 0 620 240"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="Gold spot price chart"
                  >
                    <defs>
                      <linearGradient id="fillGold" x1="0" y1="0" x2="0" y2="1">
                        <stop className="chart__stop-top" offset="0%" />
                        <stop className="chart__stop-bot" offset="100%" />
                      </linearGradient>
                    </defs>
                    <g className="chart__grid" data-chart-grid=""></g>
                    <path className="chart__area" data-chart-area="" d="" />
                    <path className="chart__stroke" data-chart-stroke="" d="" />
                    <circle className="chart__cursor" data-chart-cursor="" r="4" cx="0" cy="0" />
                  </svg>
                </div>
                <div className="chart__foot num">
                  <span>24h High <b data-stat="high">—</b></span>
                  <span>24h Low <b data-stat="low">—</b></span>
                  <span>Prev close <b data-stat="prev">—</b></span>
                  <span>Window move <b className="chg" data-chart-change="">—</b></span>
                  <span className="chart__foot--note" data-stat="note">Loading the shared spot feed…</span>
                </div>
              </article>

              {/* live order tape */}
              <article className="card bento__tape">
                <header className="card__head">
                  <h3 className="card__title num">
                    <span className="tag__pulse" aria-hidden="true"></span> Live asks
                  </h3>
                  <span className="card__tag num">spot-linked · requotes every minute</span>
                </header>
                {/* Filled by lib/home.js from /api/quote?ids=… — the same quotes
                    the product pages show. ids: 1 oz Gold Eagle (49), Buffalo (561), Gold
                    Maple (28), Britannia (25), Silver Eagle (4), Silver Maple (1), Pt Maple (5), 100 oz RCM bar (65). */}
                <ul className="fills num" aria-label="Live asks on flagship products" data-feed data-feed-ids="49,561,28,25,4,1,5,65">
                  <li className="fill fill--buy"><span className="fill__type">ASK</span><span className="fill__item">Loading live quotes…</span><span className="fill__price">—</span><span className="fill__time">—</span></li>
                </ul>
                <p className="fills__note">Cash ask per piece and the sell-back bid at the published 1.5% spread. Not an order feed.</p>
              </article>

              {/* metals quick strip */}
              <article className="card bento__metal metal-card metal-card--gold">
                <div className="metal-card__top">
                  <span className="metal-card__sym num">XAU</span>
                  <span className="tag num chg" data-dir={spotDir(spot, "XAU")}>
                    {fmtChange(spot, "XAU") || "indicative"}
                  </span>
                </div>
                <h3 className="metal-card__name">Physical Gold</h3>
                <div className="metal-card__price num">{fmtSpot(spot, "XAU")}</div>
                <div className="metal-card__sub num">
                  <span>99.99% pure</span>
                  <span>1 oz · coins &amp; bars</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- home.js retargets this href from the live quote */}
                <p className="metal-card__from num"><a href="/product/49" data-from-link="">1 oz Gold Eagle from</a> <b data-from-price="49">—</b></p>
              </article>

              <article className="card bento__metal metal-card metal-card--silver">
                <div className="metal-card__top">
                  <span className="metal-card__sym num">XAG</span>
                  <span className="tag num chg" data-dir={spotDir(spot, "XAG")}>
                    {fmtChange(spot, "XAG") || "indicative"}
                  </span>
                </div>
                <h3 className="metal-card__name">Physical Silver</h3>
                <div className="metal-card__price num">{fmtSpot(spot, "XAG")}</div>
                <div className="metal-card__sub num">
                  <span>{spot?.prices?.XAU && spot?.prices?.XAG ? `Ratio: ${(spot.prices.XAU / spot.prices.XAG).toFixed(1)} : 1` : "Ratio: —"}</span>
                  <span>Monster boxes &amp; rounds</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- home.js retargets this href from the live quote */}
                <p className="metal-card__from num"><a href="/product/1" data-from-link="">1 oz Silver Maple from</a> <b data-from-price="1">—</b></p>
              </article>

              <article className="card bento__metal metal-card metal-card--plat">
                <div className="metal-card__top">
                  <span className="metal-card__sym num">XPT</span>
                  <span className="tag num chg" data-dir={spotDir(spot, "XPT")}>
                    {fmtChange(spot, "XPT") || "indicative"}
                  </span>
                </div>
                <h3 className="metal-card__name">Platinum</h3>
                <div className="metal-card__price num">{fmtSpot(spot, "XPT")}</div>
                <div className="metal-card__sub num">
                  <span>Industrial &amp; mint</span>
                  <span>Rare allocation</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- home.js retargets this href from the live quote */}
                <p className="metal-card__from num"><a href="/product/5" data-from-link="">1 oz Platinum Maple from</a> <b data-from-price="5">—</b></p>
              </article>

              {/* market liquidity meter */}
              <article className="card bento__quote quote">
                <div className="quote__head">
                  <span className="quote__eyebrow num">Rockwell Prime Desk</span>
                  <span className="tag tag--live num">
                    <span className="tag__pulse" aria-hidden="true"></span> desk live
                  </span>
                </div>
                <h3 className="quote__title">Instant spot-linked execution</h3>
                <p className="quote__sub">
                  Zero slippage on orders up to $500,000. 120-second price freeze on checkout. Settle by Fedwire or card.
                </p>
                <div className="quote__grid num">
                  <div>
                    <span>Bid spread</span>
                    <b className="gain">0.50%</b>
                  </div>
                  <div>
                    <span>Vault yield</span>
                    <b>0.00% fee yr 1</b>
                  </div>
                  <div>
                    <span>Insured pool</span>
                    <b>$250M Lloyd&apos;s</b>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* drops strip */}
        <section className="section" id="drops">
          <div className="wrap">
            <div className="section__head">
              <div>
                <span className="section__index num">02 / Active Drops</span>
                <p className="eyebrow">
                  <span className="eyebrow__dot" aria-hidden="true"></span> Live now
                </p>
                <h2 className="section__title">Drops &amp; auctions</h2>
                <p className="section__sub">Limited verified inventory, released in timed market drops.</p>
              </div>
              <a className="section__more" href="/market">
                All drops →
              </a>
            </div>

            <div className="drops" role="list">
              {/* drop 1 */}
              <article
                className="drop"
                role="listitem"
                style={{ cursor: "pointer" }}
                onClick={() =>
                  openCheckout({
                    id: "eagle-2025",
                    title: "American Gold Eagle 2025 · 1 oz",
                    price: 2552,
                    mint: "U.S. Mint",
                    image: "/assets/coin-eagle.png",
                  })
                }
              >
                <div className="drop__media">
                  <img src="/assets/coin-eagle.png" alt="1 oz American Gold Eagle coin" />
                </div>
                <div className="drop__body">
                  <h3 className="drop__name">American Gold Eagle</h3>
                  <p className="drop__meta">2025 · U.S. Mint · 1 oz · 99.99% Au</p>
                  <div className="drop__row">
                    <span className="drop__price num" data-price data-weight="1" data-premium="0.069">
                      $2,552
                    </span>
                    <span className="drop__prem num">Spot + 6.9%</span>
                  </div>
                  <div className="drop__tags num">
                    <span className="pill pill--ok">verified</span>
                    <span className="pill">insured delivery</span>
                  </div>
                  <div className="drop__foot">
                    <span className="drop__closes num">live stock and close time on <Link href="/drops">drops &amp; auctions</Link></span>
                  </div>
                </div>
              </article>

              {/* drop 2, live auction state */}
              <article
                className="drop drop--auction"
                role="listitem"
                style={{ cursor: "pointer" }}
                onClick={() =>
                  openCheckout({
                    id: "britannia-2025",
                    title: "Gold Britannia 2025 · 1 oz",
                    price: 2548,
                    mint: "The Royal Mint",
                    image: "/assets/coin-britannia.png",
                  })
                }
              >
                <div className="drop__media">
                  <img src="/assets/coin-britannia.png" alt="1 oz Gold Britannia coin" />
                  <span className="tag tag--live">
                    <span className="tag__pulse" aria-hidden="true"></span> Live auction
                  </span>
                </div>
                <div className="drop__body">
                  <h3 className="drop__name">Gold Britannia</h3>
                  <p className="drop__meta">2025 · Royal Mint · 1 oz · 99.99% Au</p>
                  <div className="drop__row drop__row--bid">
                    <div className="drop__bid">
                      <span className="drop__bidlabel num">Bid ladder</span>
                      <span className="drop__price num" style={{ fontSize: 15 }}>
                        <Link href="/drops">open the live auction room →</Link>
                      </span>
                    </div>
                  </div>
                  <div className="drop__tags num">
                    <span className="pill pill--ok">verified</span>
                    <span className="pill">vault eligible</span>
                  </div>
                  <div className="drop__foot drop__foot--auction">
                    <span className="drop__closes num">current bid, bid count and close time are on the auction room</span>
                  </div>
                </div>
              </article>

              {/* drop 3 */}
              <article
                className="drop"
                role="listitem"
                style={{ cursor: "pointer" }}
                onClick={() =>
                  openCheckout({
                    id: "maple-2025",
                    title: "Canadian Gold Maple Leaf 2025 · 1 oz",
                    price: 2519,
                    mint: "Royal Canadian Mint",
                    image: "/assets/coin-maple.png",
                  })
                }
              >
                <div className="drop__media">
                  <img src="/assets/coin-maple.png" alt="1 oz Canadian Gold Maple Leaf coin" />
                </div>
                <div className="drop__body">
                  <h3 className="drop__name">Gold Maple Leaf</h3>
                  <p className="drop__meta">2025 · RCM · 1 oz · 99.99% Au</p>
                  <div className="drop__row">
                    <span className="drop__price num" data-price data-weight="1" data-premium="0.055">
                      $2,519
                    </span>
                    <span className="drop__prem num">Spot + 5.5%</span>
                  </div>
                  <div className="drop__tags num">
                    <span className="pill pill--ok">verified</span>
                    <span className="pill">vault eligible</span>
                  </div>
                  <div className="drop__foot">
                    <span className="drop__closes num">live stock and close time on <Link href="/drops">drops &amp; auctions</Link></span>
                  </div>
                </div>
              </article>

              {/* drop 4 */}
              <article
                className="drop"
                role="listitem"
                style={{ cursor: "pointer" }}
                onClick={() =>
                  openCheckout({
                    id: "kangaroo-2025",
                    title: "Australian Gold Kangaroo 2025 · 1 oz",
                    price: 2538,
                    mint: "The Perth Mint",
                    image: "/assets/coin-kangaroo.png",
                  })
                }
              >
                <div className="drop__media">
                  <img src="/assets/coin-kangaroo.png" alt="1 oz Australian Gold Kangaroo coin" />
                </div>
                <div className="drop__body">
                  <h3 className="drop__name">Gold Kangaroo</h3>
                  <p className="drop__meta">2025 · Perth Mint · 1 oz · 99.99% Au</p>
                  <div className="drop__row">
                    <span className="drop__price num" data-price data-weight="1" data-premium="0.063">
                      $2,538
                    </span>
                    <span className="drop__prem num">Spot + 6.3%</span>
                  </div>
                  <div className="drop__tags num">
                    <span className="pill pill--ok">verified</span>
                    <span className="pill">vault eligible</span>
                  </div>
                  <div className="drop__foot">
                    <span className="drop__closes num">live stock and close time on <Link href="/drops">drops &amp; auctions</Link></span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* vault feature */}
        <section className="section vault" id="vault">
          <div className="wrap vault__inner">
            <div className="vault__art">
              <div className="vault__halo"></div>
              <img
                className="vault__coin"
                src="/assets/coin-angel.png"
                alt="2023 St. Helena 1 oz Gold Lucky Angel proof coin"
              />
            </div>

            <div className="vault__copy">
              <span className="section__index num">04 / Vault Verification</span>
              <p className="eyebrow">
                <span className="eyebrow__dot" aria-hidden="true"></span> Vault asset · verified collectible
              </p>
              <h2 className="vault__title">St. Helena Lucky Angel</h2>
              <p className="vault__lead">
                A 2023 one-ounce proof in 99.99 fine gold — struck on the East India Company&apos;s historic guinea-angel design. Low mintage, museum-grade strike, sealed and serial-tracked from mint to your vault.
              </p>

              <dl className="spec">
                <div>
                  <dt>Provenance</dt>
                  <dd className="num">EIC · St. Helena · 2023</dd>
                </div>
                <div>
                  <dt>Purity</dt>
                  <dd className="num">99.99% Au</dd>
                </div>
                <div>
                  <dt>Grade</dt>
                  <dd className="num">PF70 Ultra Cameo</dd>
                </div>
                <div>
                  <dt>Weight</dt>
                  <dd className="num">1 oz (31.103 g)</dd>
                </div>
              </dl>

              {/* custody receipt */}
              <div className="passport">
                <div className="passport__head">
                  <span className="passport__k">Custody receipt · Rockwell verified</span>
                  <span className="passport__live">
                    <span className="tag__pulse" aria-hidden="true"></span> verified against the ledger on request
                  </span>
                </div>
                <div className="passport__rows num">
                  <div>
                    <span>Rockwell ID</span>
                    <b>RM-AU-23-0419</b>
                  </div>
                  <div>
                    <span>Assay method</span>
                    <b>XRF + ultrasonic</b>
                  </div>
                  <div>
                    <span>Serial status</span>
                    <b className="passport__ok">Sealed · matched</b>
                  </div>
                  <div>
                    <span>Chain of custody</span>
                    <b>Mint → Rockwell vault</b>
                  </div>
                  <div>
                    <span>Custody option</span>
                    <b>Allocated or insured ship</b>
                  </div>
                  <div>
                    <span>Ledger sync</span>
                    <b className="passport__ok">Confirmed on-ledger</b>
                  </div>
                </div>
              </div>

              <div className="vault__foot">
                <button
                  type="button"
                  className="btn btn--gold"
                  onClick={() =>
                    openCheckout({
                      id: "angel-pf70",
                      title: "St. Helena Lucky Angel PF70 · 1 oz",
                      price: 2761,
                      mint: "East India Co. / St. Helena",
                      image: "/assets/coin-angel.png",
                      serial: "RM-AU-23-0419",
                    })
                  }
                >
                  Reserve this piece · $2,761
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => openVerifySerial("RM-AU-23-0419")}
                >
                  View verification report
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* trust / authentication band */}
        <section className="section trust" id="proof">
          <div className="wrap">
            <div className="section__head">
              <div>
                <span className="section__index num">05 / Proof &amp; Custody</span>
                <p className="eyebrow">
                  <span className="eyebrow__dot" aria-hidden="true"></span> Built on the hardness scale
                </p>
                <h2 className="section__title">Provable down to the metal</h2>
              </div>
            </div>

            <div className="trust__grid">
              <article className="trust__card">
                <span className="trust__icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                    <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L3.2 7.7l5.4-.8L12 2z" />
                  </svg>
                </span>
                <h3 className="trust__name">XRF spectrometer assay</h3>
                <p className="trust__copy">
                  Every coin and bar undergoes non-destructive X-ray fluorescence testing upon intake to verify elemental composition down to 99.99% purity.
                </p>
              </article>
              <article className="trust__card">
                <span className="trust__icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                  </svg>
                </span>
                <h3 className="trust__name">$250M Lloyd&apos;s insurance</h3>
                <p className="trust__copy">
                  All vaulted and in-transit metals are fully underwritten by Lloyd&apos;s of London at 100% replacement value.
                </p>
              </article>
              <article className="trust__card">
                <span className="trust__icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 3" />
                  </svg>
                </span>
                <h3 className="trust__name">Instant 90s locked bid</h3>
                <p className="trust__copy">
                  Liquidate your holdings in 1 click at tight market spreads with a same-day Fedwire payout.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>

      {/* footer */}
      <footer className="footer">
        <div className="footer__ticker" aria-hidden="true">
          <div className="footer__track">
            {[
              { sym: "XAU", label: "Gold" },
              { sym: "XAG", label: "Silver" },
              { sym: "XPT", label: "Platinum" },
              { sym: "XAU", label: "Gold" },
            ].map((t, i) => (
              <span className="num" key={i}>
                {t.label} <b>{fmtSpot(spot, t.sym)}</b>{" "}
                {spot?.live && <i className="chg" data-dir={spotDir(spot, t.sym)}>{fmtChange(spot, t.sym)}</i>}
              </span>
            ))}
          </div>
        </div>

        <div className="wrap footer__inner">
          <div className="footer__brand">
            <span className="footer__brand"><BrandLogo descriptor="GOLD" size={28} /></span>
            <p className="footer__line">The hard asset, traded like a digital one.</p>
          </div>

          <nav className="footer__cols" aria-label="Footer">
            <div>
              <h4>Market</h4>
              <Link href="/#drops">Live drops</Link>
              <Link href="/market">Coins &amp; bars</Link>
              <Link href="/vault">The vault</Link>
            </div>
            <div>
              <h4>Company</h4>
              <a href="/legal/about">About</a>
              <a href="/legal/authentication">Authentication</a>
              <a href="/legal/custody-charter">Custody</a>
            </div>
            <div>
              <h4>Account</h4>
              <a href="/vault">Your vault</a>
              <a href="/vault#sellback">Sell back</a>
              <a href="/vault#activity">Statements</a>
            </div>
          </nav>
        </div>

        <div className="wrap footer__legal">
          <span className="num">© 2026 Rockwell Metals</span>
          <span className="footer__legal-links">
            <a href="/legal/terms">Terms</a>
            <a href="/legal/privacy">Privacy</a>
            <a href="/legal/disclosures">Disclosures</a>
          </span>
          <span className="footer__fine">Prices indicative. Physical metal involves market risk.</span>
        </div>
      </footer>

      {/* market tape */}
      <div className="tape-bar" aria-hidden="true">
        <div className="tape-bar__track" data-tape></div>
      </div>
    </>
  );
}
