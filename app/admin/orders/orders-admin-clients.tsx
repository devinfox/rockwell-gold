"use client";

// Order flow ops (blueprint §2.2): OMS grid, deep order inspector,
// pick/pack/ship terminal with scan verification, transit control.

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OpsShell } from "../ops-shell";
import { useRm, usd, usd0, ago, fmtDateTime } from "../../lib/use-rm";
import { STATUS_LABEL, CARRIER_LABEL, type Carrier, type OrderStatus } from "../../lib/rm-types";
import { statusTone } from "../../orders/orders-clients";
import { useConfirm } from "../../components/confirm-dialog";
import { useActionRunner } from "../use-action-runner";

const STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "IN_ASSAY", "ALLOCATED", "FULFILLMENT_QUEUE", "DISPATCHED", "DELIVERED", "CANCELLED"];

// ————— /admin/orders —————

export function AdminOrdersClient() {
  const rm = useRm(5000);
  const router = useRouter();
  const { db } = rm;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const rows = (db?.orders ?? []).filter((o) => {
    if (status && o.status !== status) return false;
    if (!q) return true;
    const u = db?.users.find((x) => x.id === o.userId);
    const hay = `${o.id} ${u?.fullName} ${o.items.map((i) => i.title).join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <OpsShell rm={rm} current="/admin/orders" title="Order management.">
      <div className="ops-filters">
        <input className="rm-input" placeholder="Search order, customer, SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rm-select num" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <span className="ops-filters__count num">{rows.length} orders</span>
      </div>

      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th className="r">Total</th><th>Rail</th><th>Custody</th><th>Age</th></tr></thead>
          <tbody>
            {rows.map((o) => {
              const u = db?.users.find((x) => x.id === o.userId);
              return (
                <tr key={o.id} className="rm-rowlink" onClick={() => router.push(`/admin/orders/${o.id}`)}>
                  <td className="num"><b><Link href={`/admin/orders/${o.id}`} style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()}>{o.id}</Link></b></td>
                  <td><div className="rm-cellmain"><b>{u?.fullName}</b><span className="num">{u?.kycTier.replace("_", " ")}</span></div></td>
                  <td>{o.items.map((i) => `${i.title.slice(0, 28)} ×${i.quantity}`).join("; ")}</td>
                  <td><span className="st" data-tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</span></td>
                  <td className="r num"><b>{usd0(o.totalUsd)}</b></td>
                  <td className="num">{o.payMethod}</td>
                  <td className="num">{o.custody}</td>
                  <td className="num">{ago(o.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OpsShell>
  );
}

// ————— /admin/orders/[id] —————

export function AdminOrderDetailClient({ orderId }: { orderId: string }) {
  const rm = useRm(4000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [busy, setBusy] = useState<string | null>(null);
  const [carrier, setCarrier] = useState<Carrier>("BRINKS");
  const { confirm, confirmElement } = useConfirm();
  const o = db?.orders.find((x) => x.id === orderId);
  const u = o && db ? db.users.find((x) => x.id === o.userId) : null;

  const run = async (action: string, payload: Record<string, unknown> = {}, confirmText?: string) => {
    if (!o) return;
    if (confirmText && !(await confirm({ title: "Confirm action", body: confirmText }))) return;
    setBusy(action);
    try {
      await runner.run(action, { orderId: o.id, ...payload });
    } finally {
      setBusy(null);
    }
  };
  // Controls the server would refuse for this role are disabled with the
  // reason in the tooltip, so a Support desk never sees a live "Dispatch".
  const gate = (action: string) => ({ disabled: !!busy || !runner.can(action), title: runner.why(action) });

  return (
    <OpsShell rm={rm} current="/admin/orders" title={o ? `Inspector · ${o.id}` : "Inspector"}>
      {confirmElement}
      {!o ? (
        <p className="rm-sub">Unknown order. <Link href="/admin/orders" style={{ color: "var(--gold-ink)" }}>← OMS</Link></p>
      ) : (
        <div className="rm-grid2">
          <div className="rm-form">
            <div className="rm-panel">
              <p className="rm-panel__k">Order state
                <span className="st" data-tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</span>
              </p>
              <div className="rm-actions">
                {o.status === "PENDING_PAYMENT" && (
                  <button className="btn btn--gold" {...gate("confirmPayment")} onClick={() => run("confirmPayment", {}, `Confirm wire receipt of ${usd(o.totalUsd)} for order ${o.id}?`)}>
                    {busy === "confirmPayment" ? "Confirming…" : "Confirm wire receipt"}
                  </button>
                )}
                {o.status === "PAID" && (
                  <button className="btn btn--gold" {...gate("startAssay")} onClick={() => run("startAssay")}>
                    {busy === "startAssay" ? "Routing…" : "Route to assay"}
                  </button>
                )}
                {(o.status === "PAID" || o.status === "IN_ASSAY") && (
                  <button className="btn btn--gold" {...gate("allocateOrder")} onClick={() => run("allocateOrder")}>
                    {busy === "allocateOrder" ? "Binding serials…" : "Assign serials · allocate"}
                  </button>
                )}
                {o.status === "FULFILLMENT_QUEUE" && (
                  <>
                    <select className="rm-select num" style={{ width: "auto" }} value={carrier} onChange={(e) => setCarrier(e.target.value as Carrier)} aria-label="Carrier" disabled={!runner.can("dispatchOrder")}>
                      {(Object.keys(CARRIER_LABEL) as Carrier[]).map((c) => <option key={c} value={c}>{CARRIER_LABEL[c]}</option>)}
                    </select>
                    <button className="btn btn--gold" {...gate("dispatchOrder")} onClick={() => run("dispatchOrder", { carrier }, `Dispatch order ${o.id} via ${CARRIER_LABEL[carrier]}?`)}>
                      {busy === "dispatchOrder" ? "Manifesting…" : "Dispatch armored"}
                    </button>
                  </>
                )}
                {!["DELIVERED", "CANCELLED"].includes(o.status) && (
                  <button className="btn btn--ghost" {...gate("cancelOrder")} onClick={() => run("cancelOrder", {}, `Are you sure you want to cancel order ${o.id} and return stock?`)}>
                    Cancel · return stock
                  </button>
                )}
                {o.custody === "DELIVERY" && (
                  <button className="btn btn--ghost" onClick={() => window.print()}>Print packing slip</button>
                )}
              </div>
              <p className="rm-note num" style={{ marginTop: 12 }}>Manual overrides are atomic and land in the audit ledger under your name. Greyed controls need a different role — hover for which.</p>
            </div>

            <div className="rm-panel">
              <p className="rm-panel__k">Items &amp; serial assignment</p>
              {o.items.map((it) => (
                <div key={it.sku} className="rm-kv num" style={{ marginBottom: 12 }}>
                  <div><span>{it.title}</span><b>×{it.quantity} · {usd(it.unitPriceUsd)} / unit</b></div>
                  <div><span>SKU</span><b>{it.sku}</b></div>
                  <div><span>Premium at lock</span><b>+{it.unitPremiumPct}%</b></div>
                  <div><span>Serials</span><b className={it.allocatedSerials.length ? "ok" : ""}>{it.allocatedSerials.length ? it.allocatedSerials.join(" · ") : "unallocated"}</b></div>
                  {it.tebSeal && <div><span>TEB seal</span><b className="ok">{it.tebSeal}</b></div>}
                </div>
              ))}
            </div>

            <div className="rm-panel">
              <p className="rm-panel__k">Status history</p>
              <div className="audit">
                {[...o.history].reverse().map((h, i) => (
                  <div key={i} className="audit__row" style={{ gridTemplateColumns: "130px 1fr" }}>
                    <span className="audit__when num">{fmtDateTime(h.at)}</span>
                    <span className="audit__what"><b>{h.status}</b> <span>· by {h.by}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rm-form">
            <div className="rm-panel rm-panel--well">
              <p className="rm-panel__k">Customer 360</p>
              <div className="rm-kv num">
                <div><span>Name</span><b><Link href={`/admin/customers/${u?.id}`} style={{ color: "var(--gold-ink)" }}>{u?.fullName} →</Link></b></div>
                <div><span>KYC</span><b>{u?.kycTier.replace("_", " ")} · {u?.kycStatus}</b></div>
                <div><span>Risk</span><b>{u?.riskRating}</b></div>
                <div><span>Email</span><b>{u?.email}</b></div>
                <div><span>Account</span><b>{u?.frozen ? "FROZEN" : "Active"}</b></div>
              </div>
            </div>
            <div className="rm-panel">
              <p className="rm-panel__k">Settlement</p>
              <div className="rm-kv num">
                <div><span>Total</span><b style={{ color: "var(--gold-ink)" }}>{usd(o.totalUsd)}</b></div>
                <div><span>Rail</span><b>{o.payMethod} · {o.payRef}</b></div>
                <div><span>Spot at lock</span><b>{usd(o.spotAtLock)}</b></div>
                <div><span>Custody</span><b>{o.custody === "VAULT" ? "Allocated vault" : o.address}</b></div>
                {o.shipmentId && <div><span>Shipment</span><b><Link href="/admin/shipments" style={{ color: "var(--gold-ink)" }}>{o.shipmentId} →</Link></b></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </OpsShell>
  );
}

// ————— /admin/fulfillment —————

export function FulfillmentClient() {
  const rm = useRm(4000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [orderId, setOrderId] = useState("");
  const [serial, setSerial] = useState("");
  const [teb, setTeb] = useState("");
  const [log, setLog] = useState<{ t: string; msg: string; ok: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  const queue = (db?.orders ?? []).filter((o) => o.status === "FULFILLMENT_QUEUE");
  const withdrawals = (db?.shipments ?? []).filter((s) => s.kind === "WITHDRAWAL" && s.status === "PREPARING");
  const active = queue.find((o) => o.id === orderId) ?? queue[0];

  const pushLog = (msg: string, ok: boolean) =>
    setLog((l) => [{ t: new Date().toLocaleTimeString("en-US", { hour12: false }), msg, ok }, ...l.slice(0, 30)]);

  const scan = async () => {
    if (!active) return;
    setBusy(true);
    try {
      // The scan log is the station's own feedback channel, so refusals go
      // there rather than to the global toast stream.
      const r = await runner.run("packScan", { orderId: active.id, serial: serial.trim(), tebSeal: teb.trim() || undefined }, { quiet: true });
      if (r.ok) {
        pushLog(`✓ ${serial.trim()} matched ${active.id}${teb ? ` · sealed ${teb.trim()}` : ""}`, true);
        setSerial("");
        setTeb("");
      } else {
        pushLog(`✗ ${r.error}`, false);
      }
    } finally {
      setBusy(false);
    }
  };

  const dispatch = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const r = await runner.run("dispatchOrder", { orderId: active.id, carrier: "BRINKS" });
      pushLog(r.ok ? `→ ${active.id} manifested · Brinks armored` : `✗ dispatch refused: ${r.error}`, r.ok);
    } finally {
      setBusy(false);
    }
  };

  const dispatchWithdrawal = async (shipmentId: string) => {
    setBusy(true);
    try {
      const r = await runner.run("dispatchWithdrawal", { shipmentId });
      pushLog(r.ok ? `→ ${shipmentId} withdrawal dispatched` : `✗ ${shipmentId}: ${r.error}`, r.ok);
    } finally {
      setBusy(false);
    }
  };

  const packed = !!active && active.items.every((i) => i.packedSerials.length >= i.quantity);
  const dispatchTitle = runner.why("dispatchOrder") ?? (packed ? "" : "Every serial must be scan-verified before dispatch");

  return (
    <OpsShell rm={rm} current="/admin/fulfillment" title="Pick / pack / ship.">
      <div className="rm-grid2">
        <div className="rm-form">
          <div className="scan">
            <p className="rm-panel__k" style={{ marginBottom: 0 }}>Scan station <span className="st" data-tone="gold">serial must match allocation</span></p>
            <div className="rm-field">
              <label className="rm-label" htmlFor="ff-order" style={{ color: "var(--text-secondary)" }}>Working order</label>
              <select id="ff-order" className="rm-select num" value={active?.id ?? ""} onChange={(e) => setOrderId(e.target.value)}>
                {queue.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.items.map((i) => `${i.sku} ×${i.quantity}`).join(", ")}</option>)}
                {queue.length === 0 && <option value="">Queue empty</option>}
              </select>
            </div>
            <div className="scan__row">
              <input className="rm-input" placeholder="Scan serial · e.g. RM-AU-BUF-8119" value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scan()} />
              <input className="rm-input" placeholder="TEB seal · TEB-00000-A" value={teb} onChange={(e) => setTeb(e.target.value)} style={{ maxWidth: 180 }} />
              <button className="btn btn--gold" type="button" disabled={busy || !active || !serial.trim() || !runner.can("packScan")} title={runner.why("packScan")} onClick={scan}>Verify</button>
            </div>
            <div className="scan__log" aria-live="polite">
              {log.map((l, i) => (
                <div key={i}><span className="t">{l.t}</span><span className={l.ok ? "ok" : "err"}>{l.msg}</span></div>
              ))}
              {log.length === 0 && <div><span className="t">--:--:--</span><span>scanner idle · barcode + QR supported</span></div>}
            </div>
            {active && (
              <div className="rm-actions">
                <button className="btn btn--ghost" type="button" onClick={() => pushLog(`⎙ ZPL thermal label spooled for ${active.id}`, true)}>Print thermal label (ZPL)</button>
                <button
                  className="btn btn--gold" type="button"
                  disabled={busy || !packed || !runner.can("dispatchOrder")}
                  title={dispatchTitle}
                  onClick={dispatch}
                >
                  Dispatch · generate manifest
                </button>
              </div>
            )}
          </div>

          <div className="rm-panel">
            <p className="rm-panel__k">Vault withdrawals staging <span className="num">{withdrawals.length}</span></p>
            <div className="rm-kv num">
              {withdrawals.map((w) => (
                <div key={w.id}>
                  <span>{w.id} · {w.contents.slice(0, 42)}…</span>
                  <b><button className="btn btn--ghost" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy || !runner.can("dispatchWithdrawal")} title={runner.why("dispatchWithdrawal")} onClick={() => dispatchWithdrawal(w.id)}>Dispatch</button></b>
                </div>
              ))}
              {withdrawals.length === 0 && <p className="rm-note">No customer withdrawals staged.</p>}
            </div>
          </div>
        </div>

        <div className="rm-tablewrap">
          <table className="rm-table">
            <thead><tr><th>Order</th><th>Contents</th><th>Packed</th><th className="r">Value</th></tr></thead>
            <tbody>
              {queue.map((o) => {
                const need = o.items.reduce((a, i) => a + i.quantity, 0);
                const packed = o.items.reduce((a, i) => a + i.packedSerials.length, 0);
                return (
                  <tr key={o.id} className="rm-rowlink" onClick={() => setOrderId(o.id)} style={o.id === active?.id ? { background: "var(--elevated)" } : undefined}>
                    <td className="num"><b>{o.id}</b></td>
                    <td>{o.items.map((i) => `${i.title.slice(0, 30)} ×${i.quantity}`).join("; ")}</td>
                    <td><span className="st" data-tone={packed >= need ? "ok" : "warn"}>{packed}/{need} scanned</span></td>
                    <td className="r num">{usd0(o.totalUsd)}</td>
                  </tr>
                );
              })}
              {queue.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>Fulfillment queue is clear.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </OpsShell>
  );
}

// ————— /admin/shipments —————

export function AdminShipmentsClient() {
  const rm = useRm(4000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [busy, setBusy] = useState<string | null>(null);

  const shipments = db?.shipments ?? [];

  const move = async (action: "advanceShipment" | "flagShipmentException", shipmentId: string, extra: Record<string, unknown> = {}) => {
    setBusy(shipmentId);
    try {
      await runner.run(action, { shipmentId, ...extra });
    } finally {
      setBusy(null);
    }
  };

  return (
    <OpsShell rm={rm} current="/admin/shipments" title="Global transit control.">
      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Shipment</th><th>Carrier</th><th>Contents</th><th>Last checkpoint</th><th>Status</th><th>Seal</th><th></th></tr></thead>
          <tbody>
            {shipments.map((s) => {
              const last = s.checkpoints[s.checkpoints.length - 1];
              return (
                <tr key={s.id}>
                  <td className="num"><b>{s.id}</b><div className="rm-cellmain"><span>{s.trackingNumber}</span></div></td>
                  <td className="num">{CARRIER_LABEL[s.carrier]}</td>
                  <td>{s.contents.slice(0, 40)}{s.contents.length > 40 ? "…" : ""}</td>
                  <td className="num">{last ? `${last.location} · ${ago(last.at)}` : "staging"}</td>
                  <td><span className="st" data-tone={s.status === "DELIVERED" ? "ok" : s.status === "EXCEPTION" ? "loss" : s.status === "PREPARING" ? "warn" : "live"}>{s.status.replace("_", " ")}</span></td>
                  <td className="num">{s.tamperSealBarcode}</td>
                  <td>
                    <div className="rm-actions" style={{ flexWrap: "nowrap" }}>
                      {s.status === "IN_TRANSIT" && (
                        <button className="btn btn--ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                          disabled={busy === s.id || !runner.can("advanceShipment")} title={runner.why("advanceShipment")}
                          onClick={() => move("advanceShipment", s.id)}>
                          Advance ▸
                        </button>
                      )}
                      {(s.status === "IN_TRANSIT" || s.status === "PREPARING") && (
                        <button className="btn btn--ghost" style={{ padding: "5px 10px", fontSize: 12, color: "var(--loss)" }}
                          disabled={busy === s.id || !runner.can("flagShipmentException")} title={runner.why("flagShipmentException")}
                          onClick={() => move("flagShipmentException", s.id, { reason: "carrier delay flagged from control" })}>
                          Exception
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rm-note num" style={{ marginTop: 12 }}>
        Carrier webhooks (FedEx Custom Critical, Brinks, Malca-Amit) push checkpoints automatically in production — &ldquo;Advance&rdquo; simulates the next webhook. Exceptions open a claim path against the Lloyd&apos;s policy.
      </p>
    </OpsShell>
  );
}
