"use client";

// Timed allocation drops & live auctions (blueprint §1.2 /drops).

import Image from "next/image";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../components/site-nav";
import SiteFooter from "../components/site-footer";
import { useRm, usd, timeUntil } from "../lib/use-rm";
import type { Drop } from "../lib/rm-types";

export function useClock(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function DropCard({ d, now, onEnter }: { d: Drop; now: number; onEnter: (d: Drop) => void }) {
  const live = d.kind === "AUCTION";
  const pct = Math.max(3, Math.round((d.remaining / d.supply) * 100));
  const closed = new Date(d.endsAt).getTime() <= now;
  return (
    <article className={`drop${live ? " drop--auction" : ""}`} style={{ cursor: "pointer" }} onClick={() => onEnter(d)}>
      <div className="drop__media">
        {live ? (
          <span className="tag tag--live num"><span className="tag__pulse" aria-hidden="true"></span> {d.auctionStyle === "DUTCH" ? "Dutch · live" : "Live auction"}</span>
        ) : null}
        <span className="tag tag--scarce num">{d.remaining} left</span>
        <Image src={d.image} alt={d.title} width={420} height={420} quality={75} />
      </div>
      <div className="drop__body">
        <h3 className="drop__name">{d.title}</h3>
        <p className="drop__meta num">{d.mint} · {d.meta}</p>
        {live ? (
          <div className="drop__row drop__row--bid">
            <div className="drop__bid">
              <span className="drop__bidlabel num">Current bid · {d.bids.length} bids</span>
              <span className="drop__price num">{usd(d.priceUsd, 0)}</span>
            </div>
            <span className={`drop__timer num${closed ? "" : " drop__timer--live"}`}>{closed ? "closed" : timeUntil(d.endsAt)}</span>
          </div>
        ) : (
          <div className="drop__row">
            <span className="drop__price num">{usd(d.priceUsd, 0)}</span>
            <span className="drop__timer num">{closed ? "closed" : timeUntil(d.endsAt)}</span>
          </div>
        )}
        <div className="drop__foot">
          <div className="meter" aria-hidden="true"><span className="meter__fill" style={{ width: pct + "%" }} data-low={pct < 25 ? "true" : undefined}></span></div>
          <span className="drop__prem num">prem <b>+{d.premiumPct.toFixed(1)}%</b></span>
        </div>
        <div className="drop__tags">
          <span className="pill pill--ok num">Assay-backed</span>
          <span className="pill pill--ok num">Insured</span>
          {live && <span className="pill pill--live num">30s anti-snipe</span>}
        </div>
      </div>
    </article>
  );
}

export default function DropsClient() {
  const { db } = useRm(5000);
  const router = useRouter();
  const now = useClock();

  const drops = db?.drops ?? [];
  const auctions = drops.filter((d) => d.kind === "AUCTION");
  const timed = drops.filter((d) => d.kind === "DROP");

  const enter = (d: Drop) => router.push(`/drops/${d.id}`);

  return (
    <>
      <SiteNav current="/drops" />
      <main className="wrap rm-main">
        <div className="rm-head rm-head--row">
          <div>
            <span className="section__index num">D / Drops &amp; Auctions</span>
            <h1 className="rm-title">Limited verified inventory, released in timed market drops.</h1>
            <p className="rm-sub">Rare collectibles, proof sets, and limited allocations released on a live timer with automatic anti-snipe bidding protection.</p>
          </div>
          <a className="section__more num" href="/market">Full market floor →</a>
        </div>

        <section className="rm-section" style={{ marginTop: 0 }}>
          <div className="rm-head rm-head--row" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 20 }}>Live auction rooms <span className="card__live num" style={{ marginLeft: 8 }}><span className="tag__pulse" aria-hidden="true"></span> bidding open</span></h2>
          </div>
          <div className="drops">
            {auctions.map((d) => <DropCard key={d.id} d={d} now={now} onEnter={enter} />)}
          </div>
        </section>

        <section className="rm-section">
          <div className="rm-head rm-head--row" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 20 }}>Timed allocations</h2>
            <span className="rm-note num">fixed price · first come · counter runs to zero</span>
          </div>
          <div className="drops">
            {timed.map((d) => <DropCard key={d.id} d={d} now={now} onEnter={enter} />)}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

