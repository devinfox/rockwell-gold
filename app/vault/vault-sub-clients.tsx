"use client";

// The Vault's deep surfaces (blueprint §1.5): custody passports,
// instant sell-back liquidity, armored withdrawal, DCA engine, rewards.

import Image from "next/image";
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerShell } from "../orders/orders-clients";
import SiteNav from "../components/site-nav";
import { useFintech } from "../components/global-fintech-provider";
import { useRm, usd, usd0, ago, fmtDate } from "../lib/use-rm";
import type { Carrier, SellBackRequest, Shipment, VaultHolding, VaultPlan } from "../lib/rm-types";
import { CARRIER_LABEL } from "../lib/rm-types";

const LIVE_UNIT: Record<string, number> = {
  "buffalo-1oz": 2559, "eagle-1oz": 2552, "maple-1oz": 2519, "angel-1oz": 2722,
  "britannia-1oz": 2531, "kangaroo-1oz": 2524, "proof-eagle-1oz": 2989,
};
const liveUnit = (h: VaultHolding) => LIVE_UNIT[h.productId] ?? Math.round(h.costUsd * 1.04);

function useMyHoldings() {
  const rm = useRm(5000);
  const holdings = useMemo(() => {
    const all = rm.db?.holdings ?? [];
    // No signed-in user means no holdings — never fall back to someone else's.
    const uid = rm.session?.userId;
    return uid ? all.filter((h) => h.userId === uid) : [];
  }, [rm.db, rm.session]);
  return { ...rm, holdings };
}

// ————— /vault/holdings/[serial] —————

export function HoldingPassportClient({ serial }: { serial: string }) {
  const { db } = useRm(6000);
  const { openVerifySerial, openSellBack, openDelivery } = useFintech();
  const h = db?.holdings.find((x) => x.serialNumber.toUpperCase() === serial.toUpperCase());

  if (!db) return (<><SiteNav variant="vault" /><main className="wrap rm-main"><p className="rm-sub num">Querying master vault ledger…</p></main></>);
  if (!h) {
    return (
      <CustomerShell current="/vault" index="V / Passport" title="Serial not on the ledger.">
        <p className="rm-sub">No holding matches <b className="num">{serial}</b>. <a href="/vault" style={{ color: "var(--gold-ink)" }}>← Back to vault</a></p>
      </CustomerShell>
    );
  }

  const val = liveUnit(h);
  const pl = val - h.costUsd;

  return (
    <CustomerShell
      current="/vault"
      index={`V / ${h.serialNumber}`}
      title="Deep custody passport."
      sub="Serial-matched, assay-logged, re-verified against the Rockwell ledger on a timer. Verification is the product."
      right={<span className="st" data-tone={h.status === "VAULTED" ? "ok" : h.status === "SOLD_BACK" ? "muted" : "live"} style={{ fontSize: 12 }}>{h.status.replace("_", " ")}</span>}
    >
      <div className="rm-grid2">
        <div className="rm-form">
          <div className="droproom__media" style={{ minHeight: 260 }}>
            <span className="tag tag--scarce num" style={{ position: "absolute", top: 14, right: 14 }}>sealed · {h.grade}</span>
            <Image src={h.image} alt={h.title} width={280} height={280} quality={75} />
          </div>
          <div className="rm-panel">
            <p className="rm-panel__k">Assay record · XRF spectrometer</p>
            <div className="rm-kv">
              <div><span>Purity</span><b className="ok num">{h.purityPct}% fine</b></div>
              <div><span>Weight</span><b className="num">{h.weightOz.toFixed(2)} oz t</b></div>
              <div><span>Ultrasonic core test</span><b className="ok">Pass · Verified solid</b></div>
              <div><span>Die-mark check</span><b className="ok">Matched · {h.mint}</b></div>
              <div><span>Last re-verified</span><b className="num">{ago(h.lastVerifiedAt)}</b></div>
            </div>
          </div>
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Custody record</p>
            <div className="rm-kv">
              <div><span>Piece</span><b>{h.title}</b></div>
              <div><span>Rockwell ID</span><b className="ok num">{h.serialNumber}</b></div>
              <div><span>Vault location</span><b>{h.vaultBay}</b></div>
              <div><span>Chain of custody</span><b>{h.mint} → Rockwell vault</b></div>
              <div><span>Cost basis</span><b className="num">{usd(h.costUsd)}</b></div>
              <div><span>Live value</span><b className="num" style={{ color: "var(--gold-ink)" }}>{usd(val)}</b></div>
              <div><span>Unrealized P/L</span><b className={`num ${pl >= 0 ? "gain" : "loss"}`}>{pl >= 0 ? "+" : "−"}{usd(Math.abs(pl))}</b></div>
              <div><span>Vaulted since</span><b className="num">{fmtDate(h.createdAt)}</b></div>
              <div><span>Insurance</span><b className="ok">Lloyd&apos;s certificate · $250M policy</b></div>
            </div>
            <div className="rm-actions" style={{ marginTop: 14 }}>
              <button className="btn btn--ghost" type="button" onClick={() => openVerifySerial(h.serialNumber)}>Verify serial</button>
              <button className="btn btn--ghost" type="button" onClick={() => window.print()}>Lloyd&apos;s certificate PDF</button>
            </div>
          </div>

          {h.status === "VAULTED" && (
            <div className="rm-panel">
              <p className="rm-panel__k">Actions</p>
              <div className="rm-actions">
                <button className="btn btn--gold" type="button" onClick={() => openSellBack({ key: h.productId, name: h.title, qtyOwned: 1, weight: h.weightOz, bidPrice: Math.round(val * 0.995), image: h.image, serials: [h.serialNumber] })}>
                  Sell back at live bid
                </button>
                <a className="btn btn--ghost" href="/vault/delivery">Take physical delivery</a>
              </div>
            </div>
          )}
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /vault/sell-back —————

export function SellBackTerminalClient() {
  const { db, holdings, session, act } = useMyHoldings();
  const { addToast } = useFintech();
  const router = useRouter();
  const vaulted = holdings.filter((h) => h.status === "VAULTED");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const chosen = vaulted.filter((h) => selected.includes(h.serialNumber));
  const gross = chosen.reduce((a, h) => a + liveUnit(h), 0);
  const spread = (db?.pricing.sellbackSpreadPct ?? 0.5) / 100;
  const net = gross * (1 - spread);
  const mySellbacks = (db?.sellbacks ?? []).filter((s) => !session || s.userId === session.userId);

  const toggle = (serial: string) =>
    setSelected((prev) => (prev.includes(serial) ? prev.filter((s) => s !== serial) : [...prev, serial]));

  const toggleAll = () => {
    if (selected.length === vaulted.length) {
      setSelected([]);
    } else {
      setSelected(vaulted.map((h) => h.serialNumber));
    }
  };

  const handleExecuteClick = () => {
    if (chosen.length === 0) return;
    setConfirmOpen(true);
  };

  const confirmAndExecute = async () => {
    const s = session;
    if (!s) { router.push("/auth/sign-in"); return; }
    setBusy(true);
    setConfirmOpen(false);
    try {
      await act<SellBackRequest>("requestSellback", {
        serials: selected, title: chosen[0]?.title,
        lockedBidUsd: +(net / Math.max(1, chosen.length)).toFixed(2), payout: "WIRE",
      });
      setSelected([]);
      addToast("Sell-back submitted", `Liquidation of ${usd(net)} submitted · funds disburse in ~3 minutes.`, "gain");
    } catch (e) {
      addToast("Sell-back failed", e instanceof Error ? e.message : "Try again.", "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell
      current="/vault/sell-back"
      index="V2 / Liquidity"
      title="Instant sell-back terminal."
      sub="Freeze a 90-second live bid at a 0.5% spread, execute in one click, and receive a same-day bank wire."
    >
      <div className="rm-grid2">
        <div className="rm-tablewrap">
          <table className="rm-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={vaulted.length > 0 && selected.length === vaulted.length}
                    onChange={toggleAll}
                    aria-label="Select all holdings"
                  />
                </th>
                <th>Holding</th>
                <th>Serial</th>
                <th className="r">Cost</th>
                <th className="r">Live bid</th>
              </tr>
            </thead>
            <tbody>
              {vaulted.map((h) => (
                <tr key={h.serialNumber} className="rm-rowlink" onClick={() => toggle(h.serialNumber)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.includes(h.serialNumber)}
                      onChange={() => toggle(h.serialNumber)}
                      aria-label={`Select ${h.serialNumber}`}
                    />
                  </td>
                  <td>
                    <div className="rm-cellrow">
                      <span className="rm-thumb"><Image src={h.image} alt="" width={72} height={72} quality={60} /></span>
                      <div className="rm-cellmain"><b>{h.title}</b><span className="num">{h.vaultBay}</span></div>
                    </div>
                  </td>
                  <td className="num">{h.serialNumber}</td>
                  <td className="r num">{usd0(h.costUsd)}</td>
                  <td className="r num" style={{ color: "var(--gold-ink)", fontWeight: 700 }}>{usd0(liveUnit(h) * (1 - spread))}</td>
                </tr>
              ))}
              {vaulted.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No vaulted holdings available for liquidation.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Liquidation Quote <span className="st" data-tone="live">90s price hold</span></p>
            <div className="rm-kv num">
              <div><span>Selected items</span><b>{chosen.length} piece{chosen.length === 1 ? "" : "s"}</b></div>
              <div><span>Gross value at spot</span><b>{usd(gross)}</b></div>
              <div><span>Spread vs. spot</span><b>{(spread * 100).toFixed(2)}%</b></div>
              <div><span>Settlement time</span><b>Same-day Fedwire</b></div>
              <div style={{ paddingTop: 8, borderTop: "1px solid var(--hairline)" }}>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>Total payout</span>
                <b style={{ color: "var(--gold-ink)", fontSize: 20 }}>{usd(net)}</b>
              </div>
            </div>
            <button className="btn btn--gold btn--lg btn--block" style={{ marginTop: 14 }} type="button" disabled={busy || chosen.length === 0} onClick={handleExecuteClick}>
              {busy ? "Processing liquidation…" : chosen.length === 0 ? "Select holdings to liquidate" : `Execute sell-back · ${usd(net)}`}
            </button>
            <p className="rm-note" style={{ marginTop: 10, textAlign: "center" }}>
              Custody reverts to Rockwell Treasury upon disbursement.
            </p>
          </div>

          <div className="rm-panel">
            <p className="rm-panel__k">Recent Liquidations</p>
            <div className="rm-kv num">
              {mySellbacks.map((s) => (
                <div key={s.id}>
                  <span>{s.id} · {s.title} ×{s.quantity}</span>
                  <b><span className="st" data-tone={s.status === "DISBURSED" ? "ok" : s.status === "REJECTED" ? "loss" : "warn"}>{s.status}</span></b>
                </div>
              ))}
              {mySellbacks.length === 0 && <p className="rm-note">No recent liquidation requests.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 12, padding: 24, maxWidth: 440, width: "100%" }}>
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Confirm Sell-Back Liquidation</h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
              You are about to sell back <b>{chosen.length} piece(s)</b> for an immediate locked payout of <b style={{ color: "var(--gold-ink)" }}>{usd(net)}</b> via <b>bank wire</b>.
            </p>
            <div className="rm-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn--ghost" type="button" onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="btn btn--gold" type="button" onClick={confirmAndExecute}>Confirm &amp; Disburse</button>
            </div>
          </div>
        </div>
      )}
    </CustomerShell>
  );
}

// ————— /vault/delivery —————

export function WithdrawalClient() {
  const { db, holdings, session, act } = useMyHoldings();
  const { addToast } = useFintech();
  const router = useRouter();
  const vaulted = holdings.filter((h) => h.status === "VAULTED");
  const [selected, setSelected] = useState<string[]>([]);
  const [street, setStreet] = useState("2847 Sutter St");
  const [suite, setSuite] = useState("");
  const [city, setCity] = useState("San Francisco");
  const [state, setState] = useState("CA");
  const [zip, setZip] = useState("94115");
  const [carrier, setCarrier] = useState<Carrier>("BRINKS");
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<Shipment | null>(null);

  const toggle = (serial: string) =>
    setSelected((prev) => (prev.includes(serial) ? prev.filter((s) => s !== serial) : [...prev, serial]));

  const toggleAll = () => {
    if (selected.length === vaulted.length) {
      setSelected([]);
    } else {
      setSelected(vaulted.map((h) => h.serialNumber));
    }
  };

  const execute = async () => {
    const s = session;
    if (!s) { router.push("/auth/sign-in"); return; }
    if (!street || !city || !state || !zip) {
      addToast("Address incomplete", "Please fill in all address fields.", "info");
      return;
    }
    const fullAddress = `${street}${suite ? ` ${suite}` : ""}, ${city}, ${state} ${zip}`;
    setBusy(true);
    try {
      const shp = await act<Shipment>("requestWithdrawal", { userId: s.userId, serials: selected, address: fullAddress, carrier });
      setManifest(shp);
      setSelected([]);
      addToast("Transit manifest created", `Shipment ${shp.id} dispatched to the fulfillment queue.`, "gain");
    } catch (e) {
      addToast("Withdrawal failed", e instanceof Error ? e.message : "Try again.", "info");
    } finally {
      setBusy(false);
    }
  };

  const myWithdrawals = (db?.shipments ?? []).filter((x) => x.kind === "WITHDRAWAL" && (!session || x.userId === session.userId));

  return (
    <CustomerShell
      current="/vault/delivery"
      index="V4 / Withdrawal"
      title="Physical armored withdrawal."
      sub="Select individual vaulted pieces, choose your preferred armored carrier, and generate a tracked transit manifest."
    >
      <div className="rm-grid2">
        <div className="rm-tablewrap">
          <table className="rm-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={vaulted.length > 0 && selected.length === vaulted.length}
                    onChange={toggleAll}
                    aria-label="Select all holdings"
                  />
                </th>
                <th>Holding</th>
                <th>Serial</th>
                <th>Bay</th>
              </tr>
            </thead>
            <tbody>
              {vaulted.map((h) => (
                <tr key={h.serialNumber} className="rm-rowlink" onClick={() => toggle(h.serialNumber)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.includes(h.serialNumber)}
                      onChange={() => toggle(h.serialNumber)}
                      aria-label={`Select ${h.serialNumber}`}
                    />
                  </td>
                  <td>
                    <div className="rm-cellrow">
                      <span className="rm-thumb"><Image src={h.image} alt="" width={72} height={72} quality={60} /></span>
                      <div className="rm-cellmain"><b>{h.title}</b><span className="num">{h.grade}</span></div>
                    </div>
                  </td>
                  <td className="num">{h.serialNumber}</td>
                  <td className="num">{h.vaultBay}</td>
                </tr>
              ))}
              {vaulted.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No vaulted holdings available for withdrawal.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="rm-form">
          <div className="rm-panel">
            <p className="rm-panel__k">Transit Configuration</p>
            <div className="rm-form">
              <div className="rm-field">
                <label className="rm-label" htmlFor="wd-street">Street address <span className="hint">Recipient photo ID required</span></label>
                <input id="wd-street" className="rm-input" required value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Main Street" />
              </div>
              <div className="rm-formrow">
                <div className="rm-field">
                  <label className="rm-label" htmlFor="wd-suite">Apt / Suite <span className="hint">optional</span></label>
                  <input id="wd-suite" className="rm-input" value={suite} onChange={(e) => setSuite(e.target.value)} placeholder="Suite 400" />
                </div>
                <div className="rm-field">
                  <label className="rm-label" htmlFor="wd-city">City</label>
                  <input id="wd-city" className="rm-input" required value={city} onChange={(e) => setCity(e.target.value)} placeholder="San Francisco" />
                </div>
              </div>
              <div className="rm-formrow">
                <div className="rm-field">
                  <label className="rm-label" htmlFor="wd-state">State / Region</label>
                  <input id="wd-state" className="rm-input" required value={state} onChange={(e) => setState(e.target.value)} placeholder="CA" />
                </div>
                <div className="rm-field">
                  <label className="rm-label" htmlFor="wd-zip">ZIP / Postal Code</label>
                  <input id="wd-zip" className="rm-input num" required value={zip} onChange={(e) => setZip(e.target.value)} placeholder="94115" />
                </div>
              </div>

              <div className="rm-field">
                <span className="rm-label">Armored carrier line</span>
                <div className="seg" role="group" aria-label="Carrier">
                  {(["BRINKS", "FEDEX_PRIORITY", "MALCA_AMIT"] as Carrier[]).map((c) => (
                    <button key={c} type="button" className={`seg__opt${carrier === c ? " is-on" : ""}`} onClick={() => setCarrier(c)}>
                      {CARRIER_LABEL[c]} <small>{c === "BRINKS" ? "Armored · 2-day" : c === "FEDEX_PRIORITY" ? "Priority · Insured" : "High-value white glove"}</small>
                    </button>
                  ))}
                </div>
              </div>

              <button className="btn btn--gold btn--lg btn--block" type="button" disabled={busy || selected.length === 0} onClick={execute}>
                {busy ? "Generating manifest…" : selected.length === 0 ? "Select serials to withdraw" : `Generate transit manifest · ${selected.length} piece${selected.length === 1 ? "" : "s"}`}
              </button>
              <p className="rm-note" style={{ textAlign: "center" }}>Holdings transition to the fulfillment queue with 100% door-to-door insurance.</p>
            </div>
          </div>

          {manifest && (
            <div className="rm-panel rm-panel--well">
              <p className="rm-panel__k">Manifest Issued <span className="st" data-tone="ok">Queued</span></p>
              <div className="rm-kv num">
                <div><span>Shipment</span><b>{manifest.id}</b></div>
                <div><span>Tracking</span><b>{manifest.trackingNumber}</b></div>
                <div><span>Tamper seal</span><b>{manifest.tamperSealBarcode}</b></div>
              </div>
            </div>
          )}

          {myWithdrawals.length > 0 && (
            <div className="rm-panel">
              <p className="rm-panel__k">Withdrawal History</p>
              <div className="rm-kv num">
                {myWithdrawals.map((w) => (
                  <div key={w.id}>
                    <span><a href={`/orders/tracking/${w.id}`} style={{ color: "var(--gold-ink)" }}>{w.id}</a> · {CARRIER_LABEL[w.carrier]}</span>
                    <b><span className="st" data-tone={w.status === "DELIVERED" ? "ok" : w.status === "PREPARING" ? "warn" : "live"}>{w.status.replace("_", " ")}</span></b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /vault/vaultplan —————

export function VaultPlanClient() {
  const { db, session, act } = useRm();
  const { addToast } = useFintech();
  const router = useRouter();
  const uid = session?.userId;
  const plan = uid ? db?.vaultPlans.find((v) => v.userId === uid) : undefined;
  const [weekly, setWeekly] = useState<number | null>(null);
  const amount = weekly ?? plan?.weeklyUsd ?? 250;
  const oz = amount / 2559;

  const save = async (active: boolean) => {
    const s = session;
    if (!s) { router.push("/auth/sign-in"); return; }
    await act<VaultPlan>("setVaultPlan", { weeklyUsd: amount, active });
    addToast(
      active ? "VaultPlan active" : "VaultPlan paused",
      active ? `Recurring buy of ${usd0(amount)}/week · first allocation executes Monday 9:00 AM EST.` : "Recurring allocations paused — resume anytime.",
      active ? "gain" : "info",
    );
  };

  return (
    <CustomerShell
      current="/vault/vaultplan"
      index="V3 / VaultPlan"
      title="Dollar-cost average your metal."
      sub="Automate weekly purchases directly into allocated custody with retained volume discounts."
      right={plan?.active ? <span className="st" data-tone="ok" style={{ fontSize: 12 }}>ACTIVE · {usd0(plan.weeklyUsd)}/wk</span> : <span className="st" data-tone="muted" style={{ fontSize: 12 }}>PAUSED</span>}
    >
      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Weekly Allocation</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
            <span className="num" style={{ fontSize: 40, fontWeight: 700, color: "var(--gold-ink)" }}>{usd0(amount)}</span>
            <span className="rm-note num">/ week · ≈ {oz.toFixed(3)} oz</span>
          </div>
          <input
            className="autoinvest__slider" type="range" min={50} max={1000} step={50} value={amount}
            onChange={(e) => setWeekly(parseInt(e.target.value, 10))}
            aria-label="Weekly auto-invest amount" style={{ width: "100%" }}
          />
          <div className="rm-kv num" style={{ marginTop: 18 }}>
            <div><span>Projected / year</span><b>{usd0(amount * 52)} · ≈ {(oz * 52).toFixed(2)} oz</b></div>
            <div><span>Default target</span><b>American Gold Buffalo · 1 oz</b></div>
            <div><span>Volume tier</span><b className="ok">Retained across schedule</b></div>
            <div><span>Payment rail</span><b>Bank account on file · Card fallback</b></div>
            {plan && <div><span>Next allocation</span><b>{fmtDate(plan.nextRunAt)} · 9:00 AM EST</b></div>}
            {plan && <div><span>Invested to date</span><b>{usd0(plan.totalInvestedUsd)}</b></div>}
          </div>
          <div className="rm-actions" style={{ marginTop: 16 }}>
            <button className="btn btn--gold" type="button" onClick={() => save(true)}>{plan?.active ? "Update plan" : "Turn on VaultPlan"}</button>
            {plan?.active && <button className="btn btn--ghost" type="button" onClick={() => save(false)}>Pause</button>}
          </div>
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Why DCA with VaultPlan</p>
            <div className="rm-kv">
              <div><span>Disciplined Accumulation</span><b>Automated schedule eliminates emotional timing</b></div>
              <div><span>Volume Pricing</span><b>Preferred tier rates maintained automatically</b></div>
              <div><span>Physical Custody</span><b>Direct serial-allocated bullion with insurance</b></div>
              <div><span>Full Flexibility</span><b>Pause, adjust, or liquidate anytime</b></div>
            </div>
          </div>
          <div className="rm-panel">
            <p className="rm-panel__k">Schedule Timeline</p>
            <div className="flow">
              {["Monday 9:00 AM — Automated buy executes", "9:00:15 — Spot price locked at live market", "9:01 — Physical bullion allocated & assayed", "Live — New balance appears in your vault"].map((s, i) => (
                <div key={s} className={`flow__step ${i === 0 ? "is-live" : "is-todo"}`}>
                  <span className="flow__dot" aria-hidden="true"></span>
                  <div className="flow__body"><b>{s.split(" — ")[0]}</b><span>{s.split(" — ")[1]}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /vault/rewards —————

export function RewardsClient() {
  const { db, session } = useRm();
  const uid = session?.userId;
  const myOrders = uid
    ? (db?.orders ?? []).filter((o) => o.userId === uid && o.status !== "CANCELLED")
    : [];
  const lifetime = myOrders.reduce((a, o) => a + o.totalUsd, 0) + 12400; // seeded pre-history
  const tiers = [
    { name: "STACKER", at: 0, perk: "Market access · vault custody year 1 free" },
    { name: "GUARDIAN", at: 25_000, perk: "0.25% premium discount · priority support" },
    { name: "SOVEREIGN", at: 50_000, perk: "0.5% premium discount · free armored delivery 1×/yr" },
    { name: "DYNASTY", at: 250_000, perk: "OTC pricing · dedicated trader · custody fee waived" },
  ];
  const tierIdx = tiers.reduce((acc, t, i) => (lifetime >= t.at ? i : acc), 0);
  const next = tiers[tierIdx + 1];
  const progress = next ? Math.min(100, Math.round(((lifetime - tiers[tierIdx].at) / (next.at - tiers[tierIdx].at)) * 100)) : 100;

  return (
    <CustomerShell
      current="/vault/rewards"
      index="V5 / Rewards"
      title="Stacker rewards."
      sub="Lifetime volume compounds into tighter premiums and free armored logistics. Numbers carry the excitement; the perks are contractual."
    >
      <div className="rm-grid2">
        <div className="tiercard">
          <span className="tiercard__tier num">CURRENT TIER</span>
          <h2 className="tiercard__name">{tiers[tierIdx].name}</h2>
          <p className="tiercard__sub">{tiers[tierIdx].perk}</p>
          <div className="rm-kv num">
            <div><span>Lifetime volume</span><b style={{ color: "var(--gold-ink)" }}>{usd0(lifetime)}</b></div>
            {next && <div><span>Next tier · {next.name}</span><b>{usd0(next.at - lifetime)} to go</b></div>}
            <div><span>Premium discount</span><b className="ok">{tierIdx >= 2 ? "0.5%" : tierIdx === 1 ? "0.25%" : "—"} applied at checkout</b></div>
            <div><span>Free armored delivery</span><b>{tierIdx >= 2 ? "1 unlocked this year" : `unlocks at ${usd0(50_000)}`}</b></div>
          </div>
          <div className="meter" style={{ marginTop: 18 }} aria-hidden="true">
            <span className="meter__fill" style={{ width: progress + "%" }}></span>
          </div>
          <p className="rm-note num" style={{ marginTop: 8 }}>{progress}% toward {next ? next.name : "the summit"}</p>
        </div>

        <div className="rm-panel">
          <p className="rm-panel__k">Tier ladder</p>
          <div className="rm-kv">
            {tiers.map((t, i) => (
              <div key={t.name}>
                <span style={{ color: i === tierIdx ? "var(--gold-ink)" : undefined }}>
                  {i === tierIdx ? "● " : ""}{t.name} <i className="num" style={{ fontStyle: "normal", fontSize: 11 }}>· {usd0(t.at)}+</i>
                </span>
                <b className="num" style={{ fontSize: 11.5, fontWeight: 500, textAlign: "right", maxWidth: "28ch" }}>{t.perk}</b>
              </div>
            ))}
          </div>
          <div className="rm-actions" style={{ marginTop: 16 }}>
            <a className="btn btn--gold" href="/market">Keep stacking →</a>
            <a className="btn btn--ghost" href="/vault/vaultplan">Automate with VaultPlan</a>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

