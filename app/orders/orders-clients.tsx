"use client";

// Omnichannel order history, deep order view + live armored tracking
// (blueprint §1.6 /orders, /orders/[id], /orders/tracking/[shipment_id]).

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import SiteNav from "../components/site-nav";
import SiteFooter from "../components/site-footer";
import AccountNav from "../components/account-nav";
import { useRm, usd, fmtDate, fmtDateTime, ago } from "../lib/use-rm";
import { STATUS_LABEL, CARRIER_LABEL, type OrderStatus } from "../lib/rm-types";

export function statusTone(s: OrderStatus): string {
  switch (s) {
    case "DELIVERED": case "ALLOCATED": return "ok";
    case "DISPATCHED": case "IN_ASSAY": return "live";
    case "PENDING_PAYMENT": return "warn";
    case "FULFILLMENT_QUEUE": case "PAID": return "gold";
    case "CANCELLED": return "loss";
    default: return "muted";
  }
}

function CustomerShell({ current, title, index, sub, children, right }: {
  current: string; title: string; index: string; sub?: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <>
      <SiteNav variant="vault" current="/vault" />
      <main className="wrap rm-main">
        <AccountNav current={current} />
        <div className="rm-head rm-head--row">
          <div>
            <span className="section__index num">{index}</span>
            <h1 className="rm-title">{title}</h1>
            {sub && <p className="rm-sub">{sub}</p>}
          </div>
          {right}
        </div>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

// ————— /orders —————

const ORDER_TABS: { key: "ALL" | "VAULT" | "DELIVERY" | "TRANSIT"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "VAULT", label: "Vaulted" },
  { key: "DELIVERY", label: "Direct Delivery" },
  { key: "TRANSIT", label: "In Transit" },
];

export function OrdersClient() {
  const { db, session } = useRm();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState<"ALL" | "VAULT" | "DELIVERY" | "TRANSIT">("ALL");

  // Signed out shows nothing: the previous predicate short-circuited to true
  // and listed every customer's orders (audit S-09).
  const raw = session ? (db?.orders ?? []).filter((o) => o.userId === session.userId) : [];
  const mine = raw.filter((o) => {
    if (tab === "VAULT" && o.custody !== "VAULT") return false;
    if (tab === "DELIVERY" && o.custody !== "DELIVERY") return false;
    if (tab === "TRANSIT" && o.status !== "DISPATCHED" && o.status !== "FULFILLMENT_QUEUE") return false;
    if (!q.trim()) return true;
    const match = `${o.id} ${o.items.map((i) => i.title).join(" ")} ${o.payMethod}`.toLowerCase();
    return match.includes(q.toLowerCase());
  });

  return (
    <CustomerShell
      current="/orders"
      index="O / Orders"
      title="Every order, on the ledger."
      sub="Placed → paid → assayed → allocated or dispatched → delivered. Each transition is timestamped and auditable."
    >
      {!session && (
        <p className="rm-note" role="alert" style={{ marginBottom: 16 }}>
          Not signed in — <Link href="/auth/sign-in?next=/orders" style={{ color: "var(--gold-ink)" }}>sign in</Link> to view your order ledger.
        </p>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 }}>
        {/* Segmented control exposed as a radio group: the selected tab was
            previously conveyed only by the `is-on` class (audit: a11y). */}
        <div className="seg" role="radiogroup" aria-label="Filter orders">
          {ORDER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={tab === t.key}
              tabIndex={tab === t.key ? 0 : -1}
              className={`seg__opt${tab === t.key ? " is-on" : ""}`}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => {
                // Arrow keys move between options, as a native radio group does.
                const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                const i = ORDER_TABS.findIndex((x) => x.key === tab);
                const next = ORDER_TABS[(i + dir + ORDER_TABS.length) % ORDER_TABS.length];
                setTab(next.key);
                (e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${next.key}"]`))?.focus();
              }}
              data-tab={t.key}
            >
              {t.label}{t.key === "ALL" ? ` (${raw.length})` : ""}
            </button>
          ))}
        </div>
        <div style={{ maxWidth: 280, width: "100%" }}>
          <input
            className="rm-input"
            style={{ padding: "8px 12px", fontSize: 13 }}
            placeholder="Search order ID or item…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th>Order</th><th>Items</th><th>Status</th><th className="r">Total</th><th>Rail</th><th>Custody</th><th>Placed</th><th></th>
            </tr>
          </thead>
          <tbody>
            {mine.map((o) => (
              // The row stays clickable for mouse users; the order id is a real
              // link so the row is reachable by keyboard and screen reader.
              <tr key={o.id} className="rm-rowlink" onClick={() => router.push(`/orders/${o.id}`)}>
                <td><b className="num"><Link href={`/orders/${o.id}`} style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()} aria-label={`Open order ${o.id}`}>{o.id}</Link></b></td>
                <td>
                  <div className="rm-cellrow">
                    <span className="rm-thumb">{o.items[0]?.image && <Image src={o.items[0].image} alt="" width={72} height={72} quality={60} />}</span>
                    <div className="rm-cellmain">
                      <b>{o.items[0]?.title}</b>
                      <span className="num">×{o.items.reduce((a, i) => a + i.quantity, 0)}</span>
                    </div>
                  </div>
                </td>
                <td><span className="st" data-tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</span></td>
                <td className="r num"><b>{usd(o.totalUsd)}</b></td>
                <td className="num">{o.payMethod}</td>
                <td className="num">{o.custody === "VAULT" ? "Vault" : "Delivery"}</td>
                <td className="num">{fmtDate(o.createdAt)}</td>
                <td className="num" style={{ color: "var(--gold-ink)" }} aria-hidden="true">→</td>
              </tr>
            ))}
            {mine.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>No matching orders found — <Link href="/market" style={{ color: "var(--gold-ink)" }}>enter the market floor</Link>.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </CustomerShell>
  );
}

// ————— /orders/[id] —————

const FLOW_STEPS: { key: OrderStatus[]; label: string; sub: string }[] = [
  { key: ["LOCK_INITIATED"], label: "Placed", sub: "Spot quote frozen 120s · order accepted" },
  { key: ["PENDING_PAYMENT", "PAID"], label: "Paid", sub: "Settlement verified on rail" },
  { key: ["IN_ASSAY"], label: "Assayed", sub: "XRF + ultrasonic · serial bound to your record" },
  { key: ["ALLOCATED", "FULFILLMENT_QUEUE"], label: "Allocated / Packed", sub: "Vault passport minted, or sealed in tamper-evident bag" },
  { key: ["DISPATCHED"], label: "Dispatched", sub: "Armored courier scanned the manifest" },
  { key: ["DELIVERED"], label: "Delivered", sub: "Direct signature with photo ID verification" },
];

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const { db } = useRm(4000);
  const o = db?.orders.find((x) => x.id === orderId);

  if (!db) return (<><SiteNav variant="vault" /><main className="wrap rm-main"><p className="rm-sub num">Reading order ledger…</p></main></>);
  if (!o) {
    return (
      <CustomerShell current="/orders" index="O / Orders" title="Order not found.">
        <p className="rm-sub" role="alert"><Link href="/orders" style={{ color: "var(--gold-ink)" }}>← All orders</Link></p>
      </CustomerShell>
    );
  }

  const reached = (stepIdx: number) => {
    const stagesHit = o.history.map((h) => h.status);
    return FLOW_STEPS[stepIdx].key.some((k) => stagesHit.includes(k));
  };
  const currentIdx = FLOW_STEPS.reduce((acc, _, i) => (reached(i) ? i : acc), 0);
  const cancelled = o.status === "CANCELLED";
  const serials = o.items.flatMap((i) => i.allocatedSerials);
  const shp = o.shipmentId ? db.shipments.find((s) => s.id === o.shipmentId) : null;

  return (
    <CustomerShell
      current="/orders"
      index={`O / ${o.id}`}
      title={o.items[0]?.title ?? o.id}
      right={<span className="st" data-tone={statusTone(o.status)} style={{ fontSize: 12 }}>{STATUS_LABEL[o.status]}</span>}
    >
      <div className="rm-grid2">
        <div className="rm-form">
          <div className="rm-panel">
            <p className="rm-panel__k">Fulfillment stepper</p>
            {cancelled ? (
              <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>Order cancelled — price lock expired or payment failed. Stock returned to the pool.</p>
            ) : (
              <div className="flow">
                {FLOW_STEPS.map((s, i) => {
                  const done = i < currentIdx || (i === currentIdx && o.status === "DELIVERED");
                  const live = i === currentIdx && o.status !== "DELIVERED";
                  const at = o.history.find((h) => s.key.includes(h.status))?.at;
                  return (
                    <div key={s.label} className={`flow__step ${done ? "is-done" : live ? "is-live" : "is-todo"}`}>
                      <span className="flow__dot" aria-hidden="true"></span>
                      <div className="flow__body">
                        <b>{s.label}</b>
                        <span>{s.sub}{at ? ` · ${fmtDateTime(at)}` : ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {shp && (
            <div className="rm-panel" style={{ borderColor: "color-mix(in srgb, var(--live) 35%, var(--hairline))" }}>
              <p className="rm-panel__k">In transit <span className="st" data-tone="live">{CARRIER_LABEL[shp.carrier]}</span></p>
              <div className="rm-kv num">
                <div><span>Tracking</span><b>{shp.trackingNumber}</b></div>
                <div><span>Tamper seal</span><b>{shp.tamperSealBarcode}</b></div>
                <div><span>ETA</span><b>{fmtDateTime(shp.eta)}</b></div>
              </div>
              <div className="rm-actions" style={{ marginTop: 14 }}>
                <Link className="btn btn--gold" href={`/orders/tracking/${shp.id}`}>Live armored tracking →</Link>
              </div>
            </div>
          )}
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Receipt</p>
            <div className="rm-kv num">
              <div><span>Order</span><b>{o.id}</b></div>
              {o.items.map((i) => (
                <div key={i.sku}><span>{i.title}</span><b>×{i.quantity} · {usd(i.unitPriceUsd)}</b></div>
              ))}
              <div><span>Rail</span><b>{o.payMethod} · {o.payRef}</b></div>
              <div><span>Spot at lock</span><b>{usd(o.spotAtLock)}</b></div>
              <div><span>Custody</span><b>{o.custody === "VAULT" ? "Allocated vault" : o.address}</b></div>
              <div style={{ paddingTop: 8, borderTop: "1px solid var(--hairline)" }}>
                <span style={{ color: "var(--text)" }}>Total</span><b style={{ color: "var(--gold-ink)", fontSize: 17 }}>{usd(o.totalUsd)}</b>
              </div>
            </div>
            <div className="rm-actions" style={{ marginTop: 14 }}>
              <button className="btn btn--ghost" type="button" onClick={() => window.print()}>Download PDF invoice</button>
            </div>
          </div>

          {serials.length > 0 && (
            <div className="rm-panel">
              <p className="rm-panel__k">Vault passports</p>
              <div className="rm-kv num">
                {serials.map((s) => (
                  <div key={s}>
                    <span>Serial</span>
                    <b className="ok"><Link href={`/vault/holdings/${s}`} style={{ color: "inherit" }}>{s} →</Link></b>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rm-panel">
            <p className="rm-panel__k">Status history</p>
            <div className="audit">
              {[...o.history].reverse().map((h, i) => (
                <div key={i} className="audit__row" style={{ gridTemplateColumns: "110px 1fr" }}>
                  <span className="audit__when num">{ago(h.at)}</span>
                  <span className="audit__what"><b>{h.status}</b> <span className="num" style={{ fontSize: 11 }}>· by {h.by}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /orders/tracking/[shipment_id] —————

export function TrackingClient({ shipmentId }: { shipmentId: string }) {
  const { db } = useRm(4000);
  const s = db?.shipments.find((x) => x.id === shipmentId);

  if (!db) return (<><SiteNav variant="vault" /><main className="wrap rm-main"><p className="rm-sub num">Subscribing to carrier webhooks…</p></main></>);
  if (!s) {
    return (
      <CustomerShell current="/orders" index="T / Tracking" title="Shipment not found.">
        <p className="rm-sub" role="alert"><Link href="/orders" style={{ color: "var(--gold-ink)" }}>← All orders</Link></p>
      </CustomerShell>
    );
  }

  const delivered = s.status === "DELIVERED";
  const routeSteps = 5;
  const progress = Math.min(100, Math.round((s.checkpoints.length / routeSteps) * 100));

  return (
    <CustomerShell
      current="/orders"
      index={`T / ${s.id}`}
      title="Armored transit, live."
      sub={`${CARRIER_LABEL[s.carrier]} · chain-of-custody telemetry direct from the carrier webhook.`}
      right={<span className="st" data-tone={delivered ? "ok" : s.status === "EXCEPTION" ? "loss" : "live"} style={{ fontSize: 12 }}>{s.status.replace("_", " ")}</span>}
    >
      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Route progress <span className="num">{progress}%</span></p>
          <div className="meter" aria-hidden="true" style={{ marginBottom: 20 }}>
            <span className="meter__fill" style={{ width: progress + "%" }}></span>
          </div>
          <div className="flow">
            {s.checkpoints.map((c, i) => (
              <div key={i} className={`flow__step ${i === s.checkpoints.length - 1 && !delivered ? "is-live" : "is-done"}`}>
                <span className="flow__dot" aria-hidden="true"></span>
                <div className="flow__body">
                  <b>{c.label}</b>
                  <span className="num">{c.location} · {fmtDateTime(c.at)}</span>
                </div>
              </div>
            ))}
            {!delivered && s.status !== "EXCEPTION" && (
              <div className="flow__step is-todo">
                <span className="flow__dot" aria-hidden="true"></span>
                <div className="flow__body"><b>Delivery · signature + photo ID</b><span className="num">ETA {fmtDateTime(s.eta)}</span></div>
              </div>
            )}
          </div>
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Manifest</p>
            <div className="rm-kv num">
              <div><span>Shipment</span><b>{s.id}</b></div>
              <div><span>Contents</span><b>{s.contents}</b></div>
              <div><span>Carrier</span><b>{CARRIER_LABEL[s.carrier]}</b></div>
              <div><span>Tracking</span><b>{s.trackingNumber}</b></div>
              <div><span>Tamper-evident seal</span><b className="ok">{s.tamperSealBarcode} · intact</b></div>
              <div><span>Insurance</span><b className="ok">{s.insurancePolicy} · Lloyd&apos;s</b></div>
              <div><span>Destination</span><b>{s.address}</b></div>
              {s.signatureName && <div><span>Signed</span><b className="ok">{s.signatureName} · {fmtDateTime(s.signatureAt!)}</b></div>}
            </div>
          </div>
          <div className="rm-panel">
            <p className="rm-panel__k">Seal verification</p>
            <p className="rm-note">On arrival, match the printed seal barcode against <b className="num" style={{ color: "var(--text)" }}>{s.tamperSealBarcode}</b> before signing. A broken or mismatched seal → refuse delivery and open a claim; Lloyd&apos;s coverage rides until your signature.</p>
            <div className="rm-actions" style={{ marginTop: 12 }}>
              <Link className="btn btn--ghost" href="/support/claims">Report a seal issue</Link>
            </div>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

export default CustomerShell;
export { CustomerShell };
