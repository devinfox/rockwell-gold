"use client";

// Step 4 — Vault Passport (blueprint §1.4).
//
// Assay and allocation run server-side the moment an order is paid
// (rm-db.ts settlePaidOrder), so this screen only reads the ledger. It used
// to call two staff-only actions from the customer's browser, which 403'd
// silently and left every order stuck at PAID (audit: Critical).

import React from "react";
import Link from "next/link";
import SiteNav from "../../../components/site-nav";
import SiteFooter from "../../../components/site-footer";
import { useRm, usd, fmtDateTime } from "../../../lib/use-rm";
import { STATUS_LABEL } from "../../../lib/rm-types";

export default function SuccessClient({ orderId }: { orderId: string }) {
  const { db } = useRm(3000);
  const order = db?.orders.find((o) => o.id === orderId);

  if (!db) {
    return (<><SiteNav /><main className="wrap rm-main"><p className="rm-sub num">Reading custody ledger…</p></main></>);
  }
  if (!order) {
    return (
      <>
        <SiteNav />
        <main className="wrap rm-main" style={{ maxWidth: 640 }}>
          <h1 className="rm-title">Order not found.</h1>
          <p className="rm-sub">No order {orderId} on the ledger. <Link href="/orders" style={{ color: "var(--gold-ink)" }}>See your orders →</Link></p>
        </main>
      </>
    );
  }

  const serials = order.items.flatMap((i) => i.allocatedSerials);
  const vaulted = order.status === "ALLOCATED";
  const queued = order.status === "FULFILLMENT_QUEUE";
  const pendingWire = order.status === "PENDING_PAYMENT";
  const settling = order.status === "PAID" || order.status === "IN_ASSAY";

  const title = pendingWire
    ? "Allocation reserved."
    : vaulted
      ? "Sealed, vaulted, yours."
      : queued
        ? "Sealed and queued for dispatch."
        : settling
          ? "Binding your serials…"
          : "Order settled.";

  const sub = pendingWire
    ? "Wire the settlement amount with your reference and the vault binds your serials the moment the Fedwire notice lands — the allocation holds 24 hours."
    : vaulted
      ? "Physical serials are allocated in the ledger and the audit entry is immutable. Lloyd's coverage attached."
      : queued
        ? "Serials are bound to your order. Your pieces enter the pick/pack queue — barcode-matched, sealed in a tamper-evident bag, dispatched armored."
        : settling
          ? "Payment received — assay and serial binding are running on the ledger."
          : STATUS_LABEL[order.status];

  return (
    <>
      <SiteNav />
      <main className="wrap rm-main" style={{ maxWidth: 860 }}>
        <div className="rm-head" style={{ textAlign: "center" }}>
          <span className="section__index num">Checkout / Step 4 · Passport</span>
          <h1 className="rm-title">{title}</h1>
          <p className="rm-sub" style={{ marginInline: "auto" }}>{sub}</p>
        </div>

        <div className="rm-panel rm-panel--well" style={{ marginBottom: 20 }}>
          <p className="rm-panel__k">
            Cryptographic receipt · {order.id}
            <span className="st" data-tone={vaulted || queued ? "ok" : pendingWire ? "warn" : "live"}>{STATUS_LABEL[order.status]}</span>
          </p>
          <div className="rm-kv num">
            <div><span>Item</span><b>{order.items.map((i) => `${i.title} ×${i.quantity}`).join(" · ")}</b></div>
            <div><span>{pendingWire ? "Amount due" : "Total settled"}</span><b>{usd(order.totalUsd)}</b></div>
            <div><span>Spot at lock</span><b>{order.spotAtLock ? usd(order.spotAtLock) : "—"}</b></div>
            <div><span>Rail</span><b>{order.payMethod} · ref {order.payRef}</b></div>
            <div><span>Custody</span><b>{order.custody === "VAULT" ? "Allocated Rockwell vault" : `Armored delivery · ${order.address}`}</b></div>
            <div><span>Insurance</span><b className="ok">Lloyd&apos;s syndicate · policy to $250M</b></div>
            <div><span>Placed</span><b>{fmtDateTime(order.createdAt)}</b></div>
            {serials.length > 0 && (
              <div><span>Vault Passport{serials.length > 1 ? "s" : ""}</span><b className="ok">{serials.join(" · ")}</b></div>
            )}
            {settling && serials.length === 0 && (
              <div><span>Serial binding</span><b><span className="tag__pulse" style={{ display: "inline-block", marginRight: 6 }}></span>XRF assay running…</b></div>
            )}
          </div>
        </div>

        <div className="rm-actions" style={{ justifyContent: "center" }}>
          <a className="btn btn--gold btn--lg" href="/vault">Open vault · live holdings →</a>
          <a className="btn btn--ghost btn--lg" href={`/orders/${order.id}`}>Track this order</a>
          <button className="btn btn--ghost btn--lg" type="button" onClick={() => window.print()}>Print invoice</button>
        </div>

        <p className="rm-note num" style={{ textAlign: "center", marginTop: 22 }}>
          Every step of this order is on the append-only audit ledger · re-verify any serial at any time from the Vault Passport.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
