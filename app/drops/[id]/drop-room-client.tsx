"use client";

// A single drop / live auction room (blueprint /drops/[id]):
// countdown, bid ladder, instant bid placement, 30s anti-snipe.

import Image from "next/image";
import Link from "next/link";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../../components/site-nav";
import SiteFooter from "../../components/site-footer";
import { useFintech } from "../../components/global-fintech-provider";
import { useRm, usd, ago, timeUntil } from "../../lib/use-rm";
import { createLock } from "../../lib/checkout";
import { useClock } from "../drops-client";
import type { Drop } from "../../lib/rm-types";

export default function DropRoomClient({ dropId }: { dropId: string }) {
  const { db, session, act } = useRm(3000);
  const { addToast } = useFintech();
  const router = useRouter();
  const now = useClock();

  const d = db?.drops.find((x) => x.id === dropId);
  const [bid, setBid] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!db) return (<><SiteNav current="/drops" /><main className="wrap rm-main"><p className="rm-sub num">Joining auction room…</p></main></>);
  if (!d) {
    return (
      <>
        <SiteNav current="/drops" />
        <main className="wrap rm-main" style={{ maxWidth: 640 }}>
          <h1 className="rm-title">Room not found.</h1>
          <p className="rm-sub" role="alert"><Link href="/drops" style={{ color: "var(--gold-ink)" }}>← All drops &amp; auctions</Link></p>
        </main>
      </>
    );
  }

  const isAuction = d.kind === "AUCTION";
  const closed = new Date(d.endsAt).getTime() <= now;
  const minBid = d.priceUsd + (d.bidIncrementUsd || 25);
  const bidValue = bid ?? minBid;

  const signInHere = `/auth/sign-in?next=${encodeURIComponent(`/drops/${d.id}`)}`;

  const placeBid = async () => {
    const s = session;
    if (!s) { router.push(signInHere); return; }
    setBusy(true);
    setErr(null);
    try {
      const next = await act<Drop>("placeBid", { dropId: d.id, amountUsd: bidValue });
      setBid(null);
      addToast(
        "Bid placed",
        next.extendedCount > (d.extendedCount || 0)
          ? "You lead the ladder — anti-snipe extended the clock 30 seconds."
          : "You lead the ladder at " + usd(bidValue, 0) + ".",
        "gain",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bid rejected");
    } finally {
      setBusy(false);
    }
  };

  const claimDrop = async () => {
    const s = session;
    if (!s) { router.push(signInHere); return; }
    setBusy(true);
    try {
      await act("claimDrop", { dropId: d.id });
      const lock = createLock({ productId: d.id, title: d.title, sku: "RM-DRP-" + d.id.slice(-3).toUpperCase(), image: d.image, mint: d.mint, unitPrice: d.priceUsd });
      router.push(`/checkout/${lock.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Allocation failed");
      setBusy(false);
    }
  };

  return (
    <>
      <SiteNav current="/drops" />
      <main className="wrap rm-main">
        <nav className="rm-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true">/</span>
          <Link href="/drops">Drops</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{d.title}</span>
        </nav>

        <div className="droproom">
          <div>
            <div className="droproom__media">
              {isAuction && <span className="tag tag--live num" style={{ position: "absolute", top: 14, left: 14 }}><span className="tag__pulse" aria-hidden="true"></span> {closed ? "Hammer down" : "Bidding open"}</span>}
              <span className="tag tag--scarce num" style={{ position: "absolute", top: 14, right: 14 }}>{d.remaining} of {d.supply} left</span>
              <Image src={d.image} alt={d.title} width={640} height={640} quality={80} priority />
            </div>
            <div className="rm-panel" style={{ marginTop: 20 }}>
              <p className="rm-panel__k">Lot Specifications</p>
              <div className="rm-kv">
                <div><span>Piece</span><b>{d.title}</b></div>
                <div><span>Mint</span><b>{d.mint}</b></div>
                <div><span>Specification</span><b className="num">{d.meta}</b></div>
                <div><span>Premium over spot</span><b className="num">+{d.premiumPct.toFixed(1)}%</b></div>
                <div><span>Assay standard</span><b className="ok">XRF + Ultrasonic · Sealed</b></div>
                <div><span>Custody at settlement</span><b>Allocated vault or armored delivery</b></div>
                {isAuction && <div><span>Anti-snipe protection</span><b className="num">{d.extendedCount > 0 ? `Extended ×${d.extendedCount}` : "Active (30s extension)"}</b></div>}
              </div>
            </div>
          </div>

          <div className="rm-form">
            <div className="rm-head" style={{ marginBottom: 4 }}>
              <span className="section__index num">{isAuction ? (d.auctionStyle === "DUTCH" ? "Dutch auction · price falls" : "English auction · price climbs") : "Timed allocation · fixed price"}</span>
              <h1 className="rm-title" style={{ fontSize: "clamp(24px, 3vw, 32px)" }}>{d.title}</h1>
            </div>

            <div className="droproom__timer">
              <span>{closed ? "Closed" : "Closes in"}</span>
              <b aria-live="polite">{closed ? "—" : timeUntil(d.endsAt)}</b>
            </div>

            <div className="rm-panel">
              <p className="rm-panel__k">{isAuction ? "Current Leading Bid" : "Allocation Price"}
                <span className="num" style={{ color: "var(--gold-ink)", fontSize: 22, fontWeight: 700 }}>{usd(d.priceUsd, 0)}</span>
              </p>

              {isAuction ? (
                <>
                  <div className="rm-field" style={{ marginBottom: 12 }}>
                    <label className="rm-label" htmlFor="bid-amt">Your Bid Amount <span className="hint num">Minimum {usd(minBid, 0)} · Increment {usd(d.bidIncrementUsd || 25, 0)}</span></label>
                    <div className="scan__row">
                      <div style={{ position: "relative", flex: 1 }}>
                        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--gold-ink)", fontWeight: 600 }}>$</span>
                        <input id="bid-amt" className="rm-input num" type="number" step={d.bidIncrementUsd || 25} min={minBid}
                          style={{ paddingLeft: 28 }}
                          value={bidValue} onChange={(e) => setBid(parseFloat(e.target.value) || minBid)} disabled={closed} />
                      </div>
                      <button className="btn btn--gold" type="button" disabled={busy || closed} onClick={placeBid}>
                        {closed ? "Closed" : busy ? "Placing…" : "Place bid"}
                      </button>
                    </div>
                  </div>
                  {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}
                  <p className="rm-note" style={{ fontSize: 11.5 }}>Bids placed in the final 30 seconds automatically extend the timer by 30 seconds to ensure fair pricing.</p>
                </>
              ) : (
                <>
                  <button className="btn btn--gold btn--lg btn--block" type="button" disabled={busy || closed || d.remaining <= 0} onClick={claimDrop}>
                    {closed ? "Drop closed" : d.remaining <= 0 ? "Allocation exhausted" : busy ? "Reserving…" : `Claim allocation · lock ${usd(d.priceUsd, 0)}`}
                  </button>
                  {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)", marginTop: 8 }}>{err}</p>}
                  <p className="rm-note" style={{ marginTop: 10, textAlign: "center" }}>Claiming reserves one unit and opens a 120-second price lock in checkout.</p>
                </>
              )}
            </div>

            {isAuction && (
              <div className="rm-panel">
                <p className="rm-panel__k">Bid Ladder ({d.bids.length} bids)</p>
                <div className="droproom__ladder num">
                  {d.bids.map((b, i) => (
                    <div key={i} className={`droproom__bidrow${i === 0 ? " is-lead" : ""}`}>
                      <span>{i === 0 ? "● Leading" : `#${i + 1}`} · {b.bidder}</span>
                      <b>{usd(b.amountUsd, 0)} <small>{ago(b.at)}</small></b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
