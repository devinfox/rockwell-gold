"use client";

// Vault stock ops (blueprint §2.2): master registry, mint intake
// station with assay logging, and the serial allocation station.

import React, { useState } from "react";
import Link from "next/link";
import { OpsShell } from "../ops-shell";
import { useRm, usd0, ago, fmtDate } from "../../lib/use-rm";
import { STATUS_LABEL } from "../../lib/rm-types";
import { statusTone } from "../../orders/orders-clients";
import { useActionRunner } from "../use-action-runner";

// ————— /admin/inventory —————

export function InventoryClient() {
  const rm = useRm();
  const { db } = rm;
  const lots = db?.inventory ?? [];
  const totalOz = lots.reduce((a, l) => a + l.totalUnits * l.unitWeightOz, 0);
  const allocOz = lots.reduce((a, l) => a + l.allocatedUnits * l.unitWeightOz, 0);
  const low = lots.filter((l) => l.totalUnits - l.allocatedUnits <= l.reorderAt);

  return (
    <OpsShell rm={rm} current="/admin/inventory" title="Vault stock registry."
      actions={<Link className="btn btn--gold" style={{ padding: "8px 14px", fontSize: 13 }} href="/admin/inventory/intake">+ Mint intake</Link>}>
      <div className="kpis">
        <div className="kpi"><p className="kpi__k">Verified inventory</p><p className="kpi__v num">{totalOz.toLocaleString("en-US")} oz</p><p className="kpi__sub num">{lots.length} active lots</p></div>
        <div className="kpi"><p className="kpi__k">Allocated to customers</p><p className="kpi__v num">{allocOz.toLocaleString("en-US")} oz</p><p className="kpi__sub num">{((allocOz / Math.max(1, totalOz)) * 100).toFixed(0)}% of registry</p></div>
        <div className="kpi"><p className="kpi__k">Unallocated float</p><p className="kpi__v num">{(totalOz - allocOz).toLocaleString("en-US")} oz</p><p className="kpi__sub num">available to the floor</p></div>
        <div className="kpi"><p className="kpi__k">Reorder triggers</p><p className="kpi__v num" style={{ color: low.length ? "var(--loss)" : undefined }}>{low.length}</p><p className="kpi__sub num">lots at or under threshold</p></div>
      </div>

      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Lot</th><th>SKU / piece</th><th>Vault location</th><th className="r">Units</th><th className="r">Allocated</th><th className="r">Free</th><th>Assay</th><th>Intake</th></tr></thead>
          <tbody>
            {lots.map((l) => {
              const free = l.totalUnits - l.allocatedUnits;
              return (
                <tr key={l.id}>
                  <td className="num"><b>{l.id}</b></td>
                  <td><div className="rm-cellmain"><b>{l.title}</b><span className="num">{l.sku} · {l.mint}</span></div></td>
                  <td className="num">{l.bay}</td>
                  <td className="r num">{l.totalUnits}</td>
                  <td className="r num">{l.allocatedUnits}</td>
                  <td className="r num"><b style={{ color: free <= l.reorderAt ? "var(--loss)" : "var(--gain)" }}>{free}</b>{free <= l.reorderAt && <div className="rm-cellmain"><span style={{ color: "var(--loss)" }}>reorder ≤ {l.reorderAt}</span></div>}</td>
                  <td><span className="st" data-tone={l.ultrasonicPass ? "ok" : "loss"}>{l.purityPct}% · {l.ultrasonicPass ? "pass" : "FAIL"}</span></td>
                  <td className="num">{fmtDate(l.intakeAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OpsShell>
  );
}

// ————— /admin/inventory/intake —————

export function IntakeClient() {
  const rm = useRm();
  const runner = useActionRunner(rm);
  const [form, setForm] = useState({ title: "", sku: "RM-AU-", mint: "U.S. Mint", metal: "gold", units: 50, purity: 99.99, weight: 1, bay: "", ultrasonic: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const canIntake = runner.can("intakeLot");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.purity < 90 || form.purity > 100) {
      setErr("XRF Purity must be between 90.00% and 100.00%.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await runner.run<{ id: string }>("intakeLot", {
        title: form.title, sku: form.sku, mint: form.mint, metal: form.metal,
        totalUnits: form.units, purityPct: form.purity, unitWeightOz: form.weight,
        bay: form.bay || undefined, ultrasonicPass: form.ultrasonic,
      });
      if (r.ok) setReceipt(r.result.id); else setErr(r.error);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <OpsShell rm={rm} current="/admin/inventory/intake" title="Mint intake station.">
      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Register inbound bullion</p>
          <form className="rm-form" onSubmit={submit}>
            <div className="rm-field">
              <label className="rm-label" htmlFor="in-title">Piece</label>
              <input id="in-title" className="rm-input" required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="American Gold Buffalo · 1 oz" />
            </div>
            <div className="rm-formrow">
              <div className="rm-field"><label className="rm-label" htmlFor="in-sku">SKU</label><input id="in-sku" className="rm-input num" required value={form.sku} onChange={(e) => set("sku", e.target.value)} /></div>
              <div className="rm-field"><label className="rm-label" htmlFor="in-mint">Mint</label>
                <select id="in-mint" className="rm-select" value={form.mint} onChange={(e) => set("mint", e.target.value)}>
                  {["U.S. Mint", "Royal Canadian Mint", "The Perth Mint", "The Royal Mint", "PAMP Suisse"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="rm-formrow">
              <div className="rm-field"><label className="rm-label" htmlFor="in-units">Units</label><input id="in-units" className="rm-input num" type="number" min={1} value={form.units} onChange={(e) => set("units", parseInt(e.target.value) || 1)} /></div>
              <div className="rm-field"><label className="rm-label" htmlFor="in-weight">Unit weight (oz t)</label><input id="in-weight" className="rm-input num" type="number" step="0.01" min={0.01} value={form.weight} onChange={(e) => set("weight", parseFloat(e.target.value) || 1)} /></div>
            </div>
            <div className="rm-formrow">
              <div className="rm-field">
                <label className="rm-label" htmlFor="in-purity">XRF purity (%) <span className="hint num">99.00–99.99%</span></label>
                <input id="in-purity" className="rm-input num" type="number" step="0.01" min={90} max={100} value={form.purity} onChange={(e) => set("purity", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="rm-field"><label className="rm-label" htmlFor="in-bay">Vault bay <span className="hint">blank = auto-assign</span></label><input id="in-bay" className="rm-input num" value={form.bay} onChange={(e) => set("bay", e.target.value)} placeholder="Bay B-04 · Shelf 2 · Row 11" /></div>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={form.ultrasonic} onChange={(e) => set("ultrasonic", e.target.checked)} />
              Ultrasonic core density test passed
            </label>
            {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}
            <button className="btn btn--gold btn--lg btn--block" type="submit" disabled={busy || !canIntake} title={runner.why("intakeLot")}>
              {busy ? "Registering lot…" : !canIntake ? "Read-only · Ops & Vault registers intake" : "Log assay · print serial barcode tags"}
            </button>
          </form>
        </div>

        <div className="rm-form">
          {receipt && (
            <div className="rm-panel rm-panel--well" style={{ borderColor: "var(--gold-deep)" }}>
              <p className="rm-panel__k">Lot registered <span className="st" data-tone="ok">{receipt}</span></p>
              <p className="rm-note">Serial barcode tags spooled to the vault-floor printer. The lot is live in the stock registry and available for allocation.</p>
              <div className="rm-actions" style={{ marginTop: 12 }}>
                <Link className="btn btn--ghost" href="/admin/inventory">Open registry →</Link>
              </div>
            </div>
          )}
          <div className="rm-panel">
            <p className="rm-panel__k">Intake procedure</p>
            <div className="flow">
              {[
                ["Spectrometer XRF", "Purity read on every unit · logged to the lot"],
                ["Ultrasonic core test", "Density scan catches drilled/filled fakes"],
                ["Serial tag printing", "Barcode tag per unit · sealed in flips"],
                ["Bay assignment", "Physical placement recorded — bay, shelf, row"],
              ].map(([b, s], i) => (
                <div key={b} className={`flow__step ${i === 0 ? "is-live" : "is-todo"}`}>
                  <span className="flow__dot" aria-hidden="true"></span>
                  <div className="flow__body"><b>{b}</b><span>{s}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </OpsShell>
  );
}

// ————— /admin/inventory/allocate —————

export function AllocateClient() {
  const rm = useRm(4000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [busy, setBusy] = useState<string | null>(null);

  const queue = (db?.orders ?? []).filter((o) => o.status === "PAID" || o.status === "IN_ASSAY");

  const allocate = async (orderId: string) => {
    setBusy(orderId);
    try { await runner.run("allocateOrder", { orderId }); } finally { setBusy(null); }
  };

  return (
    <OpsShell rm={rm} current="/admin/inventory/allocate" title="Serial allocation station.">
      <p className="rm-sub" style={{ marginBottom: 18 }}>
        Match pending paid orders to physical vault stock. Allocation binds bar serials to the customer record and mints the cryptographic Vault Passport; delivery orders route to pick/pack.
      </p>
      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Custody</th><th className="r">Value</th><th></th></tr></thead>
          <tbody>
            {queue.map((o) => {
              const u = db?.users.find((x) => x.id === o.userId);
              return (
                <tr key={o.id}>
                  <td className="num"><b>{o.id}</b></td>
                  <td>{u?.fullName}</td>
                  <td>{o.items.map((i) => `${i.sku} ×${i.quantity}`).join(", ")}</td>
                  <td><span className="st" data-tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</span></td>
                  <td className="num">{o.custody}</td>
                  <td className="r num">{usd0(o.totalUsd)}</td>
                  <td>
                    <button className="btn btn--gold" style={{ padding: "6px 14px", fontSize: 12.5 }}
                      disabled={busy === o.id || !runner.can("allocateOrder")} title={runner.why("allocateOrder")}
                      onClick={() => allocate(o.id)}>
                      {busy === o.id ? "Binding…" : o.custody === "VAULT" ? "Allocate · mint passport" : "Allocate → fulfillment"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {queue.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>Nothing awaiting allocation — the book is bound.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rm-panel" style={{ marginTop: "var(--gap)" }}>
        <p className="rm-panel__k">Recently minted passports</p>
        <div className="rm-kv num">
          {(db?.holdings ?? []).slice(-6).reverse().map((h) => (
            <div key={h.id}>
              <span>{h.serialNumber} · {h.title}</span>
              <b>{db?.users.find((u) => u.id === h.userId)?.fullName} · {ago(h.createdAt)}</b>
            </div>
          ))}
        </div>
      </div>
    </OpsShell>
  );
}
