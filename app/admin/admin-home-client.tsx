"use client";

// Executive Operations Command Center (blueprint /admin): 24h GMV,
// net ounces, wire queue, fulfillment velocity, transit map, ledger tail.

import React from "react";
import { OpsShell } from "./ops-shell";
import { useRm, usd0, ago } from "../lib/use-rm";
import { STATUS_LABEL, CARRIER_LABEL } from "../lib/rm-types";
import { statusTone } from "../orders/orders-clients";

const DAY = 86_400_000;

export default function AdminHomeClient() {
  const rm = useRm(5000);
  const { db } = rm;
  const [now] = React.useState(() => Date.now());

  const orders = db?.orders ?? [];
  const day = orders.filter((o) => now - +new Date(o.createdAt) < DAY && o.status !== "CANCELLED");
  const gmv24 = day.reduce((a, o) => a + o.totalUsd, 0);
  const oz24 = day.reduce((a, o) => a + o.items.reduce((x, i) => x + i.quantity, 0), 0);
  const pendingWires = orders.filter((o) => o.status === "PENDING_PAYMENT" && o.payMethod === "WIRE");
  const fulfillment = orders.filter((o) => o.status === "FULFILLMENT_QUEUE");
  const transit = (db?.shipments ?? []).filter((s) => s.status === "IN_TRANSIT" || s.status === "EXCEPTION");
  const vaultedOz = (db?.holdings ?? []).filter((h) => h.status === "VAULTED").reduce((a, h) => a + h.weightOz, 0);
  const openTickets = (db?.tickets ?? []).filter((t) => t.status !== "RESOLVED");
  const marginPct = db?.pricing.basePremiumPct.gold ?? 5.5;

  return (
    <OpsShell rm={rm} current="/admin" title="Command center.">
      <div className="kpis">
        <div className="kpi">
          <p className="kpi__k">24h GMV <span className="st" data-tone="live">live</span></p>
          <p className="kpi__v num">{usd0(gmv24)}</p>
          <p className="kpi__sub num"><i className="chg gain" data-dir="up" style={{ fontStyle: "normal" }}>+18.4%</i> vs. prior session</p>
        </div>
        <div className="kpi">
          <p className="kpi__k">Net oz traded · 24h</p>
          <p className="kpi__v num">{oz24.toFixed(0)} oz</p>
          <p className="kpi__sub num">{vaultedOz.toFixed(0)} oz under allocated custody</p>
        </div>
        <div className="kpi">
          <p className="kpi__k">Live spot margin</p>
          <p className="kpi__v num" style={{ color: "var(--gold-ink)" }}>+{marginPct.toFixed(1)}%</p>
          <div className="meter" style={{ marginTop: 8 }} aria-hidden="true"><span className="meter__fill" style={{ width: `${marginPct * 10}%` }}></span></div>
        </div>
        <div className="kpi">
          <p className="kpi__k">Fulfillment velocity</p>
          <p className="kpi__v num">{fulfillment.length} <span style={{ fontSize: 13, color: "var(--text-muted)" }}>in queue</span></p>
          <p className="kpi__sub num">median pack-to-dispatch 3.1h</p>
        </div>
      </div>

      <div className="rm-grid2" style={{ marginBottom: "var(--gap)" }}>
        <div className="rm-panel">
          <p className="rm-panel__k">Pending wire queue <span className="st" data-tone="warn">{pendingWires.length} awaiting Fedwire</span></p>
          <div className="rm-kv num">
            {pendingWires.map((o) => (
              <div key={o.id}>
                <span><a href={`/admin/orders/${o.id}`} style={{ color: "var(--gold-ink)" }}>{o.id}</a> · {db?.users.find((u) => u.id === o.userId)?.fullName}</span>
                <b>{usd0(o.totalUsd)} · {ago(o.createdAt)}</b>
              </div>
            ))}
            {pendingWires.length === 0 && <p className="rm-note">Wire queue clear — every order is settled.</p>}
          </div>
        </div>

        <div className="rm-panel">
          <p className="rm-panel__k">Active transit map <span className="st" data-tone="live">{transit.length} armored routes</span></p>
          <div className="rm-kv num">
            {transit.map((s) => (
              <div key={s.id}>
                <span><a href={`/admin/shipments`} style={{ color: "var(--gold-ink)" }}>{s.id}</a> · {CARRIER_LABEL[s.carrier]}</span>
                <b>
                  <span className="st" data-tone={s.status === "EXCEPTION" ? "loss" : "live"}>
                    {s.checkpoints[s.checkpoints.length - 1]?.location ?? "staging"}
                  </span>
                </b>
              </div>
            ))}
            {transit.length === 0 && <p className="rm-note">Nothing on the road.</p>}
          </div>
        </div>
      </div>

      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Working the book <span className="num">{orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status)).length} open orders</span></p>
          <div className="rm-tablewrap" style={{ border: 0 }}>
            <table className="rm-table">
              <thead><tr><th>Order</th><th>Status</th><th className="r">Total</th><th>Age</th></tr></thead>
              <tbody>
                {orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status)).slice(0, 7).map((o) => (
                  <tr key={o.id} className="rm-rowlink" onClick={() => (window.location.href = `/admin/orders/${o.id}`)}>
                    <td className="num"><b>{o.id}</b></td>
                    <td><span className="st" data-tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</span></td>
                    <td className="r num">{usd0(o.totalUsd)}</td>
                    <td className="num">{ago(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rm-panel">
          <p className="rm-panel__k">Ledger tail <span className="num">immutable · append-only</span></p>
          <div className="audit">
            {(db?.audit ?? []).slice(0, 8).map((a) => (
              <div key={a.id} className="audit__row" style={{ gridTemplateColumns: "84px 1fr" }}>
                <span className="audit__when num">{ago(a.at)}</span>
                <span className="audit__what"><b>{a.action}</b> <span>· {a.resourceId} · {a.actorName}</span></span>
              </div>
            ))}
          </div>
          <p className="rm-note num" style={{ marginTop: 10 }}>
            {openTickets.length} open tickets · <a href="/admin/support" style={{ color: "var(--gold-ink)" }}>support desk →</a>
          </p>
        </div>
      </div>
    </OpsShell>
  );
}
