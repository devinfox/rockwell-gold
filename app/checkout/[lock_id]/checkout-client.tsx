"use client";

// The 4-step price-lock settlement flow (blueprint §1.4).
// Step 1: 120s price freeze · Step 2: custody & delivery ·
// Step 3: multi-rail settlement · Step 4 hands off to /checkout/success.

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../../components/site-nav";
import { useFintech } from "../../components/global-fintech-provider";
import { getLock, refreshLock, dropLock, type CheckoutLock } from "../../lib/checkout";
import { useRm, usd, RmActionError } from "../../lib/use-rm";
import type { Order, PayMethod, Custody } from "../../lib/rm-types";
import { railSurcharge } from "../../lib/pricing/rules";
import { TIER_RULES, effectiveTier, tierViolation } from "../../lib/kyc-limits";

// Payment transform shared with the quote engine: card = cash ÷ 0.96, cash rails at par.
const SURCHARGE: Record<PayMethod, number> = { WIRE: railSurcharge("wire"), CARD: railSurcharge("card") };

type LiveQuote = {
  mode: string; cashPrice: number; spotUsed: number; tiers: { minQty: number; unitCash: number }[];
  indicative: boolean; lockToken: string | null;
};

/** Structured delivery address; mirrors ShippingAddress on the server. */
type ShipForm = { recipient: string; street: string; unit: string; city: string; state: string; postalCode: string; country: string; phone: string };
const EMPTY_SHIP: ShipForm = { recipient: "", street: "", unit: "", city: "", state: "", postalCode: "", country: "US", phone: "" };

/** Client-side mirror of the server's address validation, so the form points at the field first. */
function shipProblem(s: ShipForm): { field: keyof ShipForm; message: string } | null {
  if (s.recipient.trim().length < 2) return { field: "recipient", message: "Enter the recipient's full name as it appears on their photo ID." };
  if (s.street.trim().length < 5 || !/\d/.test(s.street)) return { field: "street", message: "Enter a street address with a house or building number." };
  if (/\b(p\.?\s*o\.?\s*box|post office box)\b/i.test(s.street)) return { field: "street", message: "Armored carriers cannot deliver to a P.O. Box." };
  if (s.city.trim().length < 2) return { field: "city", message: "Enter a city." };
  if (s.country === "US") {
    if (!/^[A-Za-z]{2}$/.test(s.state.trim())) return { field: "state", message: "Enter a two-letter US state (for example CA)." };
    if (!/^\d{5}(-\d{4})?$/.test(s.postalCode.trim())) return { field: "postalCode", message: "Enter a 5-digit ZIP code." };
  } else {
    if (s.state.trim().length < 2) return { field: "state", message: "Enter a state, province or region." };
    if (s.postalCode.trim().length < 3) return { field: "postalCode", message: "Enter a postal code." };
  }
  const digits = s.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return { field: "phone", message: "Enter a phone number the courier can reach on delivery day." };
  return null;
}

export default function CheckoutClient({ lockId }: { lockId: string }) {
  const router = useRouter();
  const { addToast } = useFintech();
  const { db, session, user, act } = useRm(0);
  const [spot, setSpot] = useState<{ prices: Record<string, number>; live: boolean } | null>(null);

  // One shared spot source for display and for the value written into the order.
  useEffect(() => {
    let alive = true;
    fetch("/api/spot").then((r) => r.json()).then((s) => { if (alive) setSpot(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [lock, setLock] = useState<CheckoutLock | null | undefined>(undefined);
  // 0 until mounted: the clock is client-only (the lock lives in localStorage).
  const [now, setNow] = useState(0);
  const [custody, setCustody] = useState<Custody>("VAULT");
  const [ship, setShip] = useState<ShipForm>(EMPTY_SHIP);
  const [pay, setPay] = useState<PayMethod>("WIRE");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const placed = useRef(false);

  useEffect(() => {
    const l = getLock(lockId);
    // The lock is read from localStorage, which only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLock(l);
    setNow(Date.now());
    if (l) {
      // Carry the product page's choices in; the tier gate below still applies.
      setQty(l.qty);
      if (l.payMethod) setPay(l.payMethod);
      if (l.custody) setCustody(l.custody);
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockId]);

  const metalSymbol = (() => {
    const sku = (lock?.sku ?? "").toUpperCase();
    if (sku.includes("-AG-")) return "XAG";
    if (sku.includes("-PT-")) return "XPT";
    if (sku.includes("-PD-")) return "XPD";
    return "XAU";
  })();
  const spotAtLock = lock?.spotAtLock || spot?.prices?.[metalSymbol] || 0;

  // Live quote for the locked product: supplies the tier ladder and the price
  // used when the customer re-locks. Absent for products outside the launch set.
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const fetchQuote = React.useCallback(async (productId: string): Promise<LiveQuote | null> => {
    try {
      const r = await fetch(`/api/quote?id=${encodeURIComponent(productId)}&qty=1`, { cache: "no-store" });
      if (!r.ok) return null;
      const q = (await r.json()) as LiveQuote;
      return q.mode === "enquire" ? null : q;
    } catch { return null; }
  }, []);
  useEffect(() => {
    if (!lock) return;
    let alive = true;
    fetchQuote(lock.productId).then((q) => { if (alive) setQuote(q); });
    return () => { alive = false; };
  }, [lock?.productId, fetchQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = lock && now ? Math.max(0, Math.floor((lock.expiresAt - now) / 1000)) : 0;
  const expired = lock && now ? remaining <= 0 : false;
  // Volume tier from the engine's own ladder. Without a quote (a drop, or the
  // quote endpoint unreachable) no discount is assumed — the server would
  // refuse an invented one anyway.
  const tierMult = (() => {
    if (quote && quote.tiers.length === 3 && quote.cashPrice > 0) {
      const t = qty >= 20 ? quote.tiers[2] : qty >= 5 ? quote.tiers[1] : quote.tiers[0];
      return t.unitCash / quote.cashPrice;
    }
    return 1;
  })();
  const unit = lock ? Math.round(lock.unitPrice * tierMult * (1 + SURCHARGE[pay]) * 100) / 100 : 0;
  const total = Math.round(unit * qty * 100) / 100;
  const otc = total > 50_000;

  // KYC tier limits — the same rules the server enforces in placeOrder.
  const tier = user ? effectiveTier(user) : null;
  const tierRules = tier ? TIER_RULES[tier] : null;
  const kycErr = user ? tierViolation(user, { totalUsd: total, payMethod: pay, custody }) : null;
  const verifyHref = `/auth/kyc-verification?next=${encodeURIComponent(`/checkout/${lockId}`)}`;
  const railLocked = (m: PayMethod) => !!tierRules && !tierRules.rails.includes(m);
  const deliveryLocked = !!tierRules && !tierRules.custody.includes("DELIVERY");

  const doRefresh = async () => {
    if (!lock) return;
    // Re-lock against the current server-side quote, carrying the new signed
    // lock token. Drops (no catalog quote) keep their list price and only
    // restart the hold.
    const q = await fetchQuote(lock.productId);
    if (q) setQuote(q);
    const next = refreshLock(lock.id, q ? +q.cashPrice.toFixed(2) : undefined, q?.lockToken ?? null, q?.spotUsed);
    setLock(next);
    setErr(null);
    addToast(
      "Price quote refreshed",
      q ? `Re-quoted at ${usd(q.cashPrice)} against the live mark${q.indicative ? " (indicative)" : ""} · 120s price hold restarted.`
        : "120s price hold restarted.",
      "gold",
    );
  };

  const execute = async () => {
    if (!lock || placed.current) return;
    if (!db) return; // session not resolved yet
    if (!session) {
      addToast("Sign in required", "Please sign in to complete your settlement.", "info");
      router.push(`/auth/sign-in?next=${encodeURIComponent(`/checkout/${lockId}`)}`);
      return;
    }
    if (kycErr) {
      setErr(kycErr);
      return;
    }
    if (custody === "DELIVERY") {
      const problem = shipProblem(ship);
      if (problem) {
        setErr(problem.message);
        document.getElementById(`co-ship-${problem.field}`)?.focus();
        return;
      }
    }
    setBusy(true);
    setErr(null);
    placed.current = true;
    try {
      // The server re-prices every line from the catalog against the marks in
      // the lock token; the total sent here is only compared for drift.
      const order = await act<Order>("placeOrder", {
        items: [{ productId: lock.productId, quantity: qty }],
        totalUsd: total,
        payMethod: pay,
        custody,
        shipTo: custody === "DELIVERY" ? { ...ship, unit: ship.unit || undefined } : null,
        lockToken: lock.lockToken ?? null,
      });
      dropLock(lock.id);
      router.push(`/checkout/success/${order.id}`);
    } catch (e) {
      placed.current = false;
      setBusy(false);
      if (e instanceof RmActionError && e.code === "PRICE_CHANGED") {
        setErr(e.message);
        await doRefresh();
        return;
      }
      if (e instanceof RmActionError && e.code === "BAD_ADDRESS" && typeof e.detail?.field === "string") {
        document.getElementById(`co-ship-${e.detail.field}`)?.focus();
      }
      setErr(e instanceof Error ? e.message : "Settlement failed");
    }
  };

  if (lock === undefined) {
    return (<><SiteNav /><main className="wrap rm-main"><p className="rm-sub num">Loading price lock…</p></main></>);
  }
  if (lock === null) {
    return (
      <>
        <SiteNav />
        <main className="wrap rm-main" style={{ maxWidth: 640 }}>
          <div className="rm-head">
            <span className="section__index num">Checkout / Lock</span>
            <h1 className="rm-title">Lock session expired.</h1>
            <p className="rm-sub">This price lock has already been settled or timed out. Start a fresh quote from any product page — prices freeze for 120 seconds.</p>
          </div>
          <div className="rm-actions">
            <Link className="btn btn--gold" href="/market">Back to the market floor</Link>
            <Link className="btn btn--ghost" href="/vault">Open vault</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteNav />
      <main className="wrap rm-main">
        <nav className="rm-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true">/</span>
          <Link href="/market">Market</Link><span aria-hidden="true">/</span>
          <span aria-current="page">Checkout · {lock.id}</span>
        </nav>

        <div className="co">
          <div className="rm-form">
            {/* Step 1: Price lock indicator */}
            <div className={`co-lock${expired ? " is-expired" : ""}`}>
              <span className="co-lock__left">
                <span className="tag__pulse" aria-hidden="true"></span>
                {expired ? "PRICE LOCK EXPIRED" : "PRICE FREEZE ACTIVE"}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <b className="co-lock__time num" aria-live="polite">
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                </b>
                <button type="button" className="btn btn--ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={doRefresh}>
                  ↻ {expired ? "Re-lock at live spot" : "Refresh 120s"}
                </button>
              </span>
            </div>
            <div className="co-lock__meter" aria-hidden="true">
              <span className="co-lock__meterfill" style={{ width: `${(remaining / 120) * 100}%` }}></span>
            </div>

            {/* Step 2: Custody & Delivery */}
            <div className="rm-panel">
              <p className="rm-panel__k">1. Custody &amp; Delivery Method</p>
              <div className="seg" role="group" aria-label="Custody choice">
                <button type="button" className={`seg__opt${custody === "VAULT" ? " is-on" : ""}`} onClick={() => setCustody("VAULT")}>
                  Store in allocated vault <small>Free 1st year · Lloyd&apos;s $250M policy · Instant liquidity</small>
                </button>
                <button
                  type="button"
                  className={`seg__opt${custody === "DELIVERY" ? " is-on" : ""}`}
                  onClick={() => setCustody("DELIVERY")}
                  aria-disabled={deliveryLocked}
                  style={deliveryLocked ? { opacity: 0.55 } : undefined}
                >
                  Insured armored delivery <small>{deliveryLocked ? "Locked · verify identity (Tier 2)" : "Discreet 2-day · Tamper-evident seal · ID required"}</small>
                </button>
              </div>
              {tierRules && (
                <p className="rm-note" style={{ marginTop: 10 }}>
                  {tierRules.label}: single orders to {tierRules.maxOrderUsd === Number.POSITIVE_INFINITY ? "any size" : usd(tierRules.maxOrderUsd, 0)}
                  {tier === "TIER_1" ? " · card settlement · vault custody" : ""}.
                  {tier !== "TIER_3" && <> <a href={verifyHref} style={{ color: "var(--gold-ink)" }}>Verify identity to raise limits →</a></>}
                </p>
              )}
              {custody === "DELIVERY" && (
                <fieldset className="rm-form" style={{ marginTop: 14, border: 0, padding: 0, minWidth: 0 }}>
                  <legend className="rm-label">Delivery address <span className="hint">Recipient photo ID matched at delivery · no P.O. boxes</span></legend>
                  <div className="rm-formrow">
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-ship-recipient">Recipient name</label>
                      <input id="co-ship-recipient" className="rm-input" autoComplete="shipping name" value={ship.recipient} onChange={(e) => setShip({ ...ship, recipient: e.target.value })} placeholder="As shown on photo ID" />
                    </div>
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-ship-phone">Phone for the courier</label>
                      <input id="co-ship-phone" className="rm-input num" type="tel" inputMode="tel" autoComplete="shipping tel" value={ship.phone} onChange={(e) => setShip({ ...ship, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
                    </div>
                  </div>
                  <div className="rm-formrow">
                    <div className="rm-field" style={{ flex: 2 }}>
                      <label className="rm-label" htmlFor="co-ship-street">Street address</label>
                      <input id="co-ship-street" className="rm-input" autoComplete="shipping address-line1" value={ship.street} onChange={(e) => setShip({ ...ship, street: e.target.value })} placeholder="2847 Sutter St" />
                    </div>
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-ship-unit">Apt / suite <span className="hint">optional</span></label>
                      <input id="co-ship-unit" className="rm-input" autoComplete="shipping address-line2" value={ship.unit} onChange={(e) => setShip({ ...ship, unit: e.target.value })} />
                    </div>
                  </div>
                  <div className="rm-formrow">
                    <div className="rm-field" style={{ flex: 2 }}>
                      <label className="rm-label" htmlFor="co-ship-city">City</label>
                      <input id="co-ship-city" className="rm-input" autoComplete="shipping address-level2" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} />
                    </div>
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-ship-state">{ship.country === "US" ? "State" : "Region"}</label>
                      <input id="co-ship-state" className="rm-input" autoComplete="shipping address-level1" maxLength={ship.country === "US" ? 2 : 40} value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value.toUpperCase() })} placeholder={ship.country === "US" ? "CA" : ""} />
                    </div>
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-ship-postalCode">{ship.country === "US" ? "ZIP" : "Postal code"}</label>
                      <input id="co-ship-postalCode" className="rm-input num" inputMode={ship.country === "US" ? "numeric" : "text"} autoComplete="shipping postal-code" value={ship.postalCode} onChange={(e) => setShip({ ...ship, postalCode: e.target.value })} placeholder={ship.country === "US" ? "94115" : ""} />
                    </div>
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-ship-country">Country</label>
                      <select id="co-ship-country" className="rm-input" autoComplete="shipping country" value={ship.country} onChange={(e) => setShip({ ...ship, country: e.target.value })}>
                        <option value="US">United States</option>
                        <option value="CA">Canada</option>
                        <option value="GB">United Kingdom</option>
                        <option value="CH">Switzerland</option>
                        <option value="SG">Singapore</option>
                        <option value="AU">Australia</option>
                      </select>
                    </div>
                  </div>
                  <p className="rm-note">Transit insurance auto-applied · Residential and commercial delivery eligible · adult signature and ID match required.</p>
                </fieldset>
              )}
            </div>

            {/* Step 3: Settlement rails */}
            <div className="rm-panel">
              <p className="rm-panel__k">2. Settlement Payment Method</p>
              <div className="seg" role="group" aria-label="Settlement rail">
                <button type="button" className={`seg__opt${pay === "WIRE" ? " is-on" : ""}`} onClick={() => setPay("WIRE")} aria-disabled={railLocked("WIRE")} style={railLocked("WIRE") ? { opacity: 0.55 } : undefined}>
                  Bank Wire <small>{railLocked("WIRE") ? "Locked · verify identity" : "Cash price · Same-day Fedwire"}</small>
                </button>
                <button type="button" className={`seg__opt${pay === "CARD" ? " is-on" : ""}`} onClick={() => setPay("CARD")} aria-disabled={railLocked("CARD")} style={railLocked("CARD") ? { opacity: 0.55 } : undefined}>
                  Card / Apple Pay <small>{railLocked("CARD") ? "Locked · verify identity" : `+${(SURCHARGE.CARD * 100).toFixed(1)}% · 3D Secure`}</small>
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                {pay === "WIRE" && (
                  <div className="rm-panel rm-panel--well">
                    <div className="rm-kv num">
                      <div><span>Beneficiary</span><b>Rockwell Metals Treasury LLC</b></div>
                      <div><span>ABA routing</span><b>Issued on execution</b></div>
                      <div><span>Reference</span><b>{lock.id}</b></div>
                      <div><span>Allocation hold</span><b>24 hours from receipt</b></div>
                    </div>
                    <p className="rm-note" style={{ marginTop: 10 }}>Your serial numbers are reserved immediately upon execution. Physical title binds once the wire confirms. Beneficiary details are issued with your order reference — no banking rail is connected on this environment yet.</p>
                  </div>
                )}
                {pay === "CARD" && (
                  <div className="rm-form">
                    <div className="rm-field">
                      <label className="rm-label" htmlFor="co-card">Card number</label>
                      <input id="co-card" className="rm-input num" inputMode="numeric" placeholder="4242 •••• •••• 4242" />
                    </div>
                    <div className="rm-formrow">
                      <div className="rm-field"><label className="rm-label" htmlFor="co-exp">Expiry</label><input id="co-exp" className="rm-input num" placeholder="MM / YY" /></div>
                      <div className="rm-field"><label className="rm-label" htmlFor="co-cvc">CVC</label><input id="co-cvc" className="rm-input num" placeholder="CVC" /></div>
                    </div>
                    <p className="rm-note">No card processor is connected on this environment — these fields are inert and nothing is charged.</p>
                  </div>
                )}
              </div>
            </div>

            {otc && (
              <div className="rm-panel" style={{ borderColor: "var(--gold-deep)" }}>
                <p className="rm-panel__k">Institutional Order ($50,000+)</p>
                <p className="rm-note">This order exceeds $50,000. An OTC trader can provide bespoke volume pricing and custom wire settlement.</p>
                <div className="rm-actions" style={{ marginTop: 12 }}>
                  <a className="btn btn--ghost" href="/support/otc-desk">Request OTC Desk Quote →</a>
                </div>
              </div>
            )}
          </div>

          {/* Summary Rail */}
          <aside className="co-rail">
            <div className="rm-panel">
              <p className="rm-panel__k">Order Summary <span className="st" data-tone="live">live quote</span></p>
              <div className="co-summary__item">
                <span className="rm-thumb"><Image src={lock.image} alt="" width={72} height={72} quality={60} /></span>
                <div>
                  <span className="co-summary__name">{lock.title}</span>
                  <span className="co-summary__meta num" style={{ display: "block" }}>{lock.mint} · SKU {lock.sku}</span>
                </div>
              </div>

              <div className="rm-field" style={{ marginBottom: 14 }}>
                <span className="rm-label">Quantity <span className="hint num">5–19: −1% · 20+: −2%</span></span>
                <div className="fin-qty-stepper">
                  <button type="button" className="fin-qty-stepper__btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">–</button>
                  <input type="number" className="fin-qty-stepper__input num" value={qty} min={1} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} aria-label="Quantity" />
                  <button type="button" className="fin-qty-stepper__btn" onClick={() => setQty((q) => q + 1)} aria-label="Increase">+</button>
                </div>
              </div>

              <div className="rm-kv num">
                <div>
                  <span>Spot at lock{spot && !spot.live ? " (indicative)" : ""}</span>
                  <b>{spotAtLock ? usd(spotAtLock) : "—"}</b>
                </div>
                <div><span>Unit price (incl. rail)</span><b>{usd(unit)}</b></div>
                <div><span>Volume discount</span><b>{tierMult === 1 ? "None" : `−${((1 - tierMult) * 100).toFixed(0)}%`}</b></div>
                <div><span>Payment surcharge</span><b>{SURCHARGE[pay] === 0 ? "0% (Wire)" : `+${(SURCHARGE[pay] * 100).toFixed(1)}%`}</b></div>
                <div><span>Custody</span><b>{custody === "VAULT" ? "Allocated vault · Yr 1 free" : "Armored delivery"}</b></div>
                <div style={{ paddingTop: 8, borderTop: "1px solid var(--hairline)" }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>Total settlement</span>
                  <b style={{ fontSize: 20, color: "var(--gold-ink)" }}>{usd(total)}</b>
                </div>
              </div>

              {(err || kycErr) && (
                <p className="rm-note" role="alert" style={{ color: "var(--loss)", marginTop: 10 }}>
                  {err ?? kycErr}
                  {kycErr && <> <a href={verifyHref} style={{ color: "var(--gold-ink)" }}>Verify now →</a></>}
                </p>
              )}

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn btn--gold btn--lg btn--block" type="button" disabled={busy || expired || !db || !!kycErr} onClick={execute}>
                  {busy ? "Processing settlement…" : expired ? "Lock expired — refresh quote" : !db ? "Loading account…" : `Execute · Settle ${usd(total)}`}
                </button>
                <button className="btn btn--ghost btn--block" type="button" onClick={() => { dropLock(lock.id); router.push("/market"); }}>
                  Cancel order · return stock
                </button>
              </div>
              <p className="rm-note" style={{ marginTop: 12, textAlign: "center", fontSize: 11 }}>
                Guaranteed quote {lock.id} · Allocated physical vaulting · Lloyd&apos;s insured
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

