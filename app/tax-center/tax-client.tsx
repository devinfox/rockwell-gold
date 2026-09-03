"use client";

// Tax center (blueprint §1.6): annual gain/loss, cost basis export,
// realized gain/loss statement built from actual orders and sell-backs.

import React, { useMemo } from "react";
import { CustomerShell } from "../orders/orders-clients";
import { useFintech } from "../components/global-fintech-provider";
import { useRm, usd, fmtDate, downloadCsv } from "../lib/use-rm";

export default function TaxClient() {
  const { db, session } = useRm();
  const { addToast } = useFintech();
  const uid = session?.userId ?? null;

  const rows = useMemo(() => {
    if (!db || !uid) return [];

    const buys = db.orders
      .filter((o) => o.userId === uid && !["CANCELLED", "LOCK_INITIATED", "PENDING_PAYMENT"].includes(o.status))
      .map((o) => ({
        date: o.createdAt, kind: "BUY" as const, ref: o.id,
        desc: o.items.map((i) => `${i.title} ×${i.quantity}`).join("; "),
        proceeds: 0, basis: o.totalUsd, gain: 0, basisKnown: true,
      }));

    // Real cost basis: look the disposed serials up in the holdings ledger and
    // sum what was actually paid for them. This was previously fabricated as
    // proceeds x 0.955, producing a flat 4.5% gain on every disposal regardless
    // of the true acquisition cost (audit F-02).
    const sells = db.sellbacks
      .filter((s) => s.userId === uid && s.status === "DISBURSED")
      .map((s) => {
        const matched = db.holdings.filter((h) => s.serials.includes(h.serialNumber));
        const basisKnown = matched.length === s.serials.length && matched.length > 0;
        const basis = matched.reduce((a, h) => a + h.costUsd, 0);
        const proceeds = s.lockedBidUsd * s.quantity;
        return {
          date: s.createdAt, kind: "SELL" as const, ref: s.id,
          desc: `${s.title} ×${s.quantity} · sell-back`,
          proceeds,
          basis,
          gain: basisKnown ? proceeds - basis : 0,
          basisKnown,
        };
      });

    return [...buys, ...sells].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [db, uid]);

  const unresolved = rows.filter((r) => r.kind === "SELL" && !r.basisKnown).length;

  const realized = rows.reduce((a, r) => a + r.gain, 0);
  const basis = rows.reduce((a, r) => a + r.basis, 0);
  const proceeds = rows.reduce((a, r) => a + r.proceeds, 0);
  // Transactions above the $10,000 reporting threshold, flagged for review.
  // The previous copy claimed these were "auto-filed" Form 8300 events; nothing
  // files anything, and wires are not generally 8300-reportable anyway (F-02).
  const over10k = rows.filter((r) => r.kind === "BUY" && r.basis > 10_000);

  const exportGainLoss = () => {
    downloadCsv(`rockwell-realized-gain-loss-${new Date().getFullYear()}.csv`, [
      ["Rockwell Metals — realized gain/loss statement", `Tax year ${new Date().getFullYear()}`],
      ["This is a transaction record, not a filed tax form."],
      ["Date", "Type", "Reference", "Description", "Proceeds", "Cost basis", "Realized gain", "Basis resolved"],
      ...rows.map((r) => [
        fmtDate(r.date), r.kind, r.ref, r.desc,
        r.proceeds.toFixed(2), r.basis.toFixed(2), r.gain.toFixed(2),
        r.basisKnown ? "yes" : "no",
      ]),
    ]);
    addToast("Statement exported", "Realized gain/loss CSV generated from your order and sell-back ledger.", "info");
  };

  const exportBasis = () => {
    downloadCsv("rockwell-cost-basis.csv", [
      ["Date", "Reference", "Description", "Cost basis USD"],
      ...rows.filter((r) => r.kind === "BUY").map((r) => [fmtDate(r.date), r.ref, r.desc, r.basis.toFixed(2)]),
    ]);
    addToast("Cost basis exported", "Every acquisition with its settled basis.", "info");
  };

  return (
    <CustomerShell
      current="/tax-center"
      index="X / Tax Center"
      title="Gains, on the record."
      sub="Realized P/L aggregated from your actual purchases and sell-backs. This is a transaction record to hand to your accountant — Rockwell does not file tax forms on your behalf."
      right={
        <div className="rm-actions">
          <button className="btn btn--gold" type="button" onClick={exportGainLoss}>Export gain/loss CSV</button>
          <button className="btn btn--ghost" type="button" onClick={exportBasis}>Cost basis CSV</button>
        </div>
      }
    >
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi"><p className="kpi__k">Realized gain · YTD</p><p className="kpi__v num gain">+{usd(realized)}</p><p className="kpi__sub num">across {rows.filter((r) => r.kind === "SELL").length} disposals</p></div>
        <div className="kpi"><p className="kpi__k">Total proceeds</p><p className="kpi__v num">{usd(proceeds)}</p><p className="kpi__sub num">sell-backs · disbursed</p></div>
        <div className="kpi"><p className="kpi__k">Cost basis on book</p><p className="kpi__v num">{usd(basis)}</p><p className="kpi__sub num">settled acquisitions</p></div>
        <div className="kpi"><p className="kpi__k">Over $10,000</p><p className="kpi__v num">{over10k.length}</p><p className="kpi__sub num">flagged for reporting review</p></div>
      </div>

      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th className="r">Proceeds</th><th className="r">Basis</th><th className="r">Gain</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ref + r.kind}>
                <td className="num">{fmtDate(r.date)}</td>
                <td><span className="st" data-tone={r.kind === "SELL" ? "gold" : "muted"}>{r.kind}</span></td>
                <td className="num">{r.ref}</td>
                <td>{r.desc}</td>
                <td className="r num">{r.proceeds ? usd(r.proceeds) : "—"}</td>
                <td className="r num">{usd(r.basis)}</td>
                <td className="r num">{r.gain ? <b className="gain">+{usd(r.gain)}</b> : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>No taxable events yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {unresolved > 0 && (
        <p className="rm-note num" style={{ marginTop: 14 }}>
          {unresolved} disposal(s) reference serials that are no longer on the holdings ledger, so
          their cost basis could not be resolved. Those rows show a zero gain and are marked in the
          export — reconcile them before filing.
        </p>
      )}
      <p className="rm-note num" style={{ marginTop: 14 }}>
        Physical precious metals are generally treated as IRS collectibles. This page is bookkeeping
        generated from your own transactions — it is not tax advice and not a filed return.
      </p>
    </CustomerShell>
  );
}
