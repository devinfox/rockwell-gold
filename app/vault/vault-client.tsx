"use client";

// The vault dashboard, rendered from the signed-in customer's real holdings.
//
// This page used to be static markup — a hardcoded $28,098 across 11 coins,
// driven by app/lib/vault.js and never reading /api/rm. A customer who
// completed a purchase never saw it here, even though allocateOrder mints the
// holding server-side (audit B-03). Valuation now comes from the shared spot
// source rather than a seven-entry hardcoded price map (audit F-08).

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import SiteNav from "../components/site-nav";
import SiteFooter from "../components/site-footer";
import { useFintech } from "../components/global-fintech-provider";
import ChangePasswordPanel from "../components/change-password-panel";
import { useRm, usd, usd0, ago } from "../lib/use-rm";
import type { VaultHolding } from "../lib/rm-types";
import "./vault.css";

interface SpotPayload {
  prices: Record<string, number>;
  change: Record<string, number>;
  live: boolean;
  source: string;
}

const METAL_SYMBOL: Record<string, string> = {
  gold: "XAU", silver: "XAG", platinum: "XPT", palladium: "XPD",
};

/** Infers the metal from the serial prefix the vault assigns (RM-AU-…, RM-AG-…). */
function metalOf(h: VaultHolding): string {
  const code = h.serialNumber.split("-")[1];
  return { AU: "gold", AG: "silver", PT: "platinum", PD: "palladium" }[code] ?? "gold";
}

/** Groups identical products so the table reads by position, not by serial. */
function groupHoldings(holdings: VaultHolding[]) {
  const map = new Map<string, { rows: VaultHolding[]; title: string; image: string; mint: string; metal: string }>();
  for (const h of holdings) {
    const key = h.productId || h.title;
    const g = map.get(key) ?? { rows: [], title: h.title, image: h.image, mint: h.mint, metal: metalOf(h) };
    g.rows.push(h);
    map.set(key, g);
  }
  return Array.from(map.entries()).map(([key, g]) => ({ key, ...g }));
}

export default function VaultClient() {
  const { db, session, act } = useRm(8000);
  const me = db && session ? db.users.find((u) => u.id === session.userId) ?? null : null;
  const { openSellBack, openDelivery, openVerifySerial, addToast } = useFintech();
  const [spot, setSpot] = useState<SpotPayload | null>(null);

  useEffect(() => {
    document.body.className = "vault";
    return () => { document.body.className = ""; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/spot")
      .then((r) => r.json())
      .then((s) => { if (alive) setSpot(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const holdings = useMemo(
    () => (db?.holdings ?? []).filter((h) => h.status === "VAULTED"),
    [db],
  );
  const groups = useMemo(() => groupHoldings(holdings), [holdings]);

  const valueOf = (h: VaultHolding): number | null => {
    const sym = METAL_SYMBOL[metalOf(h)];
    const px = spot?.prices?.[sym];
    if (!px) return null;
    return px * h.weightOz;
  };

  const totals = useMemo(() => {
    let value = 0;
    let cost = 0;
    let oz = 0;
    let valued = 0;
    for (const h of holdings) {
      cost += h.costUsd;
      oz += h.weightOz;
      const v = valueOf(h);
      if (v != null) { value += v; valued++; }
    }
    const spread = db?.pricing.sellbackSpreadPct ?? 0.5;
    return {
      value, cost, oz, valued,
      pl: value - cost,
      plPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
      sellNow: value * (1 - spread / 100),
      complete: valued === holdings.length,
    };
  }, [holdings, spot, db]);

  const recent = useMemo(
    () => [...(db?.orders ?? [])].slice(0, 6),
    [db],
  );

  // ————— gates —————

  if (!db) {
    return (
      <>
        <SiteNav variant="vault" />
        <main className="wrap vault__wrap"><p className="rm-sub num">Opening the vault ledger…</p></main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <SiteNav variant="vault" />
        <main className="wrap vault__wrap" id="main">
          <div className="rm-head">
            <span className="section__index num">V / Vault</span>
            <h1 className="rm-title">Sign in to open your vault.</h1>
            <p className="rm-sub">Your holdings, custody passports and sell-back liquidity live behind your Rockwell ID.</p>
          </div>
          <div className="rm-actions">
            <Link className="btn btn--gold" href="/auth/sign-in?next=/vault">Sign in</Link>
            <Link className="btn btn--ghost" href="/auth/sign-up">Open an account</Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const dir = totals.pl >= 0 ? "up" : "down";

  return (
    <>
      <SiteNav variant="vault" current="/vault" />

      <main className="wrap vault__wrap" id="main">
        <section className="vhero">
          <div className="vhero__main">
            <p className="eyebrow">
              <span className="eyebrow__dot" aria-hidden="true"></span> Vault · allocated &amp; insured
            </p>
            <h1 className="vhero__hello">
              {session.name ? `${session.name.split(" ")[0]}'s vault` : "Your vault"}
            </h1>

            <div className="vhero__total">
              <span className="vhero__val num">{holdings.length ? usd0(totals.value) : "—"}</span>
              <span className={`vhero__day num chg`} data-dir={dir}>
                {holdings.length ? `${totals.pl >= 0 ? "+" : "−"}${usd0(Math.abs(totals.pl))} unrealised` : "no holdings yet"}
              </span>
            </div>
            <p className="vhero__pl num">
              <b>{holdings.length ? `${totals.pl >= 0 ? "+" : "−"}${usd0(Math.abs(totals.pl))}` : "—"}</b>
              <span className="chg" data-dir={dir}>
                {holdings.length ? `${totals.plPct >= 0 ? "+" : ""}${totals.plPct.toFixed(2)}%` : ""}
              </span>
              <span className="muted">vs. cost basis · at {spot?.live ? "live spot" : "indicative spot"}</span>
            </p>

            <ul className="vsum num" aria-label="Portfolio summary">
              <li>
                <span className="vsum__k">Holdings</span>
                <b className="vsum__v">{totals.oz.toFixed(2)} oz</b>
                <span className="vsum__sub">{holdings.length} serial{holdings.length === 1 ? "" : "s"} · {groups.length} type{groups.length === 1 ? "" : "s"}</span>
              </li>
              <li>
                <span className="vsum__k">Cost basis</span>
                <b className="vsum__v">{holdings.length ? usd0(totals.cost) : "—"}</b>
                <span className="vsum__sub">settled acquisitions</span>
              </li>
              <li>
                <span className="vsum__k">Unrealised P/L</span>
                <b className="vsum__v chg" data-dir={dir}>
                  {holdings.length ? `${totals.pl >= 0 ? "+" : "−"}${usd0(Math.abs(totals.pl))}` : "—"}
                </b>
                <span className="vsum__sub">metal value vs. cost</span>
              </li>
              <li>
                <span className="vsum__k">Sell-back now</span>
                <b className="vsum__v">{holdings.length ? usd0(totals.sellNow) : "—"}</b>
                <span className="vsum__sub">less {db.pricing.sellbackSpreadPct}% spread</span>
              </li>
            </ul>

            {!spot?.live && holdings.length > 0 && (
              <p className="rm-note num" style={{ marginTop: 10 }}>
                Valuations use indicative reference marks — no live market feed is connected on this
                environment.
              </p>
            )}
            {!totals.complete && holdings.length > 0 && (
              <p className="rm-note num" style={{ marginTop: 6 }}>
                {holdings.length - totals.valued} holding(s) have no quoted spot market and are excluded
                from the totals.
              </p>
            )}

            <div className="vhero__cta">
              <Link className="btn btn--gold" href="/market">+ Buy more metal</Link>
              <Link className="btn btn--ghost" href="/vault/sell-back">Sell back</Link>
              <Link className="btn btn--ghost" href="/vault/delivery">Take delivery</Link>
            </div>
          </div>

          <article className="card vchart">
            <header className="vchart__head">
              <div>
                <p className="vchart__pair num">
                  <span className="spot__dot" aria-hidden="true"></span> Spot marks
                  <span className="muted"> · {spot?.live ? "live" : "indicative"}</span>
                </p>
              </div>
            </header>
            <div className="rm-kv num" style={{ padding: "4px 16px 16px" }}>
              {[
                ["Gold · XAU", "XAU"],
                ["Silver · XAG", "XAG"],
                ["Platinum · XPT", "XPT"],
              ].map(([label, sym]) => (
                <div key={sym}>
                  <span>{label}</span>
                  <b>{spot?.prices?.[sym] ? usd(spot.prices[sym]) : "—"}</b>
                </div>
              ))}
              <div>
                <span>Source</span>
                <b style={{ fontSize: 11 }}>{spot?.source ?? "—"}</b>
              </div>
            </div>
          </article>
        </section>

        {/* holdings */}
        <section className="section--v" id="holdings">
          <div className="block__head block__head--row">
            <div>
              <h2 className="block__title">Your holdings</h2>
              <p className="block__sub">
                Each serial is allocated, segregated and re-verified on a timer. Every row links to its
                custody passport.
              </p>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Nothing vaulted yet.</p>
              <p className="empty__sub">
                Buy from the market floor and choose allocated vault custody at checkout — your serials
                appear here the moment the vault desk allocates them.
              </p>
              <Link className="btn btn--gold" href="/market">Browse the market floor</Link>
            </div>
          ) : (
            <div className="holds" role="table" aria-label="Vault holdings">
              {groups.map((g) => {
                const qty = g.rows.length;
                const cost = g.rows.reduce((a, h) => a + h.costUsd, 0);
                const value = g.rows.reduce((a, h) => a + (valueOf(h) ?? 0), 0);
                const priced = g.rows.some((h) => valueOf(h) != null);
                const pl = value - cost;
                const plPct = cost > 0 ? (pl / cost) * 100 : 0;
                const rowDir = pl >= 0 ? "up" : "down";
                const unitBid = priced
                  ? (value / qty) * (1 - (db.pricing.sellbackSpreadPct ?? 0.5) / 100)
                  : 0;

                return (
                  <div className="hold" role="row" key={g.key}>
                    <div className="hold__coin" role="cell">
                      <Image src={g.image} alt="" width={96} height={96} quality={60} />
                      <div className="hold__id">
                        <b>{g.title}</b>
                        <span className="num">
                          {g.mint} · {qty} × {g.rows[0].weightOz} oz · {g.rows[0].purityPct}%
                        </span>
                      </div>
                    </div>

                    <div className="hold__val num" role="cell">
                      <b>{priced ? usd0(value) : "—"}</b>
                      <span className="muted">cost {usd0(cost)}</span>
                    </div>

                    <div className="hold__pl num" role="cell">
                      <b className="chg" data-dir={rowDir}>
                        {priced ? `${pl >= 0 ? "+" : "−"}${usd0(Math.abs(pl))}` : "—"}
                      </b>
                      <span className="chg" data-dir={rowDir}>
                        {priced ? `${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%` : ""}
                      </span>
                    </div>

                    <div className="hold__act" role="cell">
                      <button
                        className="btn btn--ghost hold__sell"
                        type="button"
                        disabled={!priced}
                        onClick={() =>
                          openSellBack({
                            key: g.key,
                            name: g.title,
                            qtyOwned: qty,
                            weight: g.rows[0].weightOz,
                            bidPrice: Math.round(unitBid),
                            image: g.image,
                            serials: g.rows.filter((h) => h.status === "VAULTED").map((h) => h.serialNumber),
                          })
                        }
                      >
                        Sell
                      </button>
                      <a className="hold__link" href={`/vault/holdings/${g.rows[0].serialNumber}`}>
                        Passport
                      </a>
                    </div>

                    <div className="hold__serials num" role="cell" style={{ gridColumn: "1 / -1", paddingTop: 6 }}>
                      {g.rows.map((h) => (
                        <button
                          key={h.serialNumber}
                          type="button"
                          className="pill pill--ok num"
                          style={{ marginRight: 6, cursor: "pointer" }}
                          onClick={() => openVerifySerial(h.serialNumber)}
                          title={`Verify ${h.serialNumber} · ${h.vaultBay}`}
                        >
                          {h.serialNumber}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* recent activity */}
        <section className="section--v" id="activity">
          <div className="block__head block__head--row">
            <div>
              <h2 className="block__title">Recent activity</h2>
              <p className="block__sub">Every order transition is timestamped on the ledger.</p>
            </div>
            <Link className="btn btn--ghost" href="/orders">All orders →</Link>
          </div>

          {recent.length === 0 ? (
            <p className="rm-sub num">No orders yet.</p>
          ) : (
            <div className="rm-tablewrap">
              <table className="rm-table">
                <thead>
                  <tr><th>Order</th><th>Items</th><th>Status</th><th className="r">Total</th><th>Placed</th></tr>
                </thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.id}>
                      <td className="num"><Link href={`/orders/${o.id}`}>{o.id}</Link></td>
                      <td>{o.items.map((i) => `${i.title} ×${i.quantity}`).join("; ")}</td>
                      <td><span className="st">{o.status.replace(/_/g, " ")}</span></td>
                      <td className="r num">{usd0(o.totalUsd)}</td>
                      <td className="num">{ago(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* account security */}
        <section className="section--v" id="account-security">
          <div className="block__head block__head--row">
            <div>
              <h2 className="block__title">Account security</h2>
              <p className="block__sub">Change your password here. Recovery runs through the support desk — see <Link href="/auth/forgot-password">account recovery</Link>.</p>
            </div>
          </div>
          <ChangePasswordPanel mustChange={!!me?.mustChangePassword} />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
