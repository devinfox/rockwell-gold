"use client";

// Support concierge realm (blueprint §1.6): command center, ticket
// threads, HNW/OTC desk, and Lloyd's claims portal.

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CustomerShell } from "../orders/orders-clients";
import SiteNav from "../components/site-nav";
import { useFintech } from "../components/global-fintech-provider";
import { useRm, usd0, ago } from "../lib/use-rm";
import type { SupportTicket, OtcQuote } from "../lib/rm-types";

const KB = [
  { k: "CUSTODY", t: "How allocated custody works", d: "Segregated, serial-matched, never lent. Your metal is your metal — audited monthly." },
  { k: "SELL-BACK", t: "Instant sell-back mechanics", d: "90-second bid locks at a 0.5% spread; wire settles same day." },
  { k: "DELIVERY", t: "Armored delivery & signatures", d: "Tamper-evident bags, direct signature with photo ID match, Lloyd's cover to your door." },
  { k: "VERIFY", t: "Verifying a serial", d: "Every passport re-verifies against the ledger — assay record, bay location, chain of custody." },
  { k: "KYC", t: "Tiers & limits", d: "Tier 1 instant under $10k, Tier 2 to $100k with ID + liveness, Tier 3 institutional." },
  { k: "TAX", t: "1099-B and Form 8300", d: "Realized ledger exports for Schedule D; >$10k cash events auto-file 8300." },
];

// ————— /support —————

export function SupportClient() {
  const { db, session, act } = useRm();
  const { addToast } = useFintech();
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mine = (db?.tickets ?? []).filter((t) => !session || t.userId === session.userId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = session;
    if (!s) { router.push("/auth/sign-in?next=/support"); return; }
    setBusy(true);
    setErr(null);
    try {
      const t = await act<SupportTicket>("createTicket", { subject, text, orderId: orderId || null });
      addToast("Ticket opened", `${t.id} routed to the staff queue — replies land right here.`, "info");
      router.push(`/support/tickets/${t.id}`);
    } catch (e2) {
      // Previously swallowed: the button just un-stuck with no explanation.
      setErr(e2 instanceof Error ? e2.message : "The desk could not open the ticket.");
      setBusy(false);
    }
  };

  return (
    <CustomerShell
      current="/support"
      index="S / Support"
      title="Concierge, on the record."
      sub="24/7 live concierge, searchable knowledge base, and a ticket queue that syncs straight to the staff desk."
      right={<Link className="btn btn--ghost" href="/support/otc-desk">Institutional OTC desk →</Link>}
    >
      <section style={{ marginBottom: 34 }}>
        <div className="kb">
          {KB.map((a) => (
            <a key={a.k} className="kb__card" href="#new-ticket" onClick={(e) => { e.preventDefault(); setSubject(a.t); document.getElementById("new-ticket")?.scrollIntoView({ behavior: "smooth" }); }}>
              <span className="kb__k">{a.k}</span>
              <h3>{a.t}</h3>
              <p>{a.d}</p>
            </a>
          ))}
        </div>
      </section>

      <div className="rm-grid2">
        <div className="rm-panel" id="new-ticket">
          <p className="rm-panel__k">Open a ticket <span className="st" data-tone="live">staff median reply 11 min</span></p>
          <form className="rm-form" onSubmit={submit}>
            <div className="rm-field">
              <label className="rm-label" htmlFor="tk-sub">Subject</label>
              <input id="tk-sub" className="rm-input" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Re-verify assay on my Britannia" />
            </div>
            <div className="rm-field">
              <label className="rm-label" htmlFor="tk-ord">Related order <span className="hint">optional</span></label>
              <input id="tk-ord" className="rm-input num" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="RM-ORD-1006" />
            </div>
            <div className="rm-field">
              <label className="rm-label" htmlFor="tk-txt">What&apos;s going on?</label>
              <textarea id="tk-txt" className="rm-textarea" required value={text} onChange={(e) => setText(e.target.value)} placeholder="Attach delivery receipts or assay questions — the thread supports follow-ups." />
            </div>
            {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}
            <button className="btn btn--gold btn--block" type="submit" disabled={busy}>{busy ? "Routing…" : "Submit to concierge queue"}</button>
          </form>
        </div>

        <div className="rm-panel">
          <p className="rm-panel__k">Your tickets</p>
          <div className="rm-kv">
            {mine.map((t) => (
              <div key={t.id}>
                <span><Link href={`/support/tickets/${t.id}`} style={{ color: "var(--gold-ink)" }} className="num">{t.id}</Link> · {t.subject}</span>
                <b><span className="st" data-tone={t.status === "RESOLVED" ? "ok" : t.status === "IN_PROGRESS" ? "live" : "warn"}>{t.status.replace("_", " ")}</span></b>
              </div>
            ))}
            {mine.length === 0 && <p className="rm-note">No tickets yet — the queue is quiet.</p>}
          </div>
          <div className="rm-actions" style={{ marginTop: 16 }}>
            <Link className="btn btn--ghost" href="/support/claims">Insurance claims portal</Link>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /support/tickets/[id] —————

export function TicketThreadClient({ ticketId }: { ticketId: string }) {
  const { db, session, act } = useRm(4000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const t = db?.tickets.find((x) => x.id === ticketId);

  if (!db) return (<><SiteNav variant="vault" /><main className="wrap rm-main"><p className="rm-sub num">Syncing thread…</p></main></>);
  if (!t) {
    return (
      <CustomerShell current="/support" index="S / Tickets" title="Ticket not found.">
        <p className="rm-sub" role="alert"><Link href="/support" style={{ color: "var(--gold-ink)" }}>← Support</Link></p>
      </CustomerShell>
    );
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = session;
    if (!s || !text.trim()) return;
    setBusy(true);
    try {
      await act("ticketReply", { id: t.id, text });
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell
      current="/support"
      index={`S / ${t.id}`}
      title={t.subject}
      right={<span className="st" data-tone={t.status === "RESOLVED" ? "ok" : t.status === "IN_PROGRESS" ? "live" : "warn"} style={{ fontSize: 12 }}>{t.status.replace("_", " ")} · {t.priority}</span>}
    >
      <div className="rm-grid2 rm-grid2--wide">
        <div className="rm-panel">
          <div className="thread" aria-live="polite">
            {t.messages.map((m, i) => (
              <div key={i} className={`thread__msg ${m.staff ? "thread__msg--staff" : "thread__msg--me"}`}>
                <div className="thread__meta num">
                  <b>{m.staff ? `${m.fromName} · Rockwell` : m.fromName}</b>
                  <span>{ago(m.at)}</span>
                </div>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
          <form className="scan__row" style={{ marginTop: 18 }} onSubmit={send}>
            <input className="rm-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={session ? "Reply to the thread…" : "Sign in to reply"} disabled={!session} />
            <button className="btn btn--gold" type="submit" disabled={busy || !session || !text.trim()}>Send</button>
          </form>
        </div>

        <div className="rm-panel rm-panel--well">
          <p className="rm-panel__k">Thread record</p>
          <div className="rm-kv num">
            <div><span>Ticket</span><b>{t.id}</b></div>
            <div><span>Kind</span><b>{t.kind}</b></div>
            <div><span>Priority</span><b>{t.priority}</b></div>
            {t.orderId && <div><span>Order</span><b><Link href={`/orders/${t.orderId}`} style={{ color: "var(--gold-ink)" }}>{t.orderId}</Link></b></div>}
            <div><span>Opened</span><b>{ago(t.createdAt)}</b></div>
            <div><span>Assigned</span><b>{t.assignee ? "Specialist on it" : "Queued"}</b></div>
          </div>
          <p className="rm-note" style={{ marginTop: 12 }}>Attach delivery receipts or request assay re-verification right in the thread — it syncs live with the staff desk.</p>
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /support/otc-desk —————

export function OtcDeskClient() {
  const { db, session, act } = useRm();
  const { addToast } = useFintech();
  const router = useRouter();
  const [notional, setNotional] = useState(250_000);
  const [metal, setMetal] = useState("gold");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = (db?.otcQuotes ?? []).filter((q) => !session || q.userId === session.userId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = session;
    if (!s) { router.push("/auth/sign-in"); return; }
    setBusy(true);
    try {
      await act<OtcQuote>("createOtcRequest", { requestText: request, notionalUsd: notional, metal });
      setRequest("");
      addToast("High-priority alert dispatched", "A senior trader has your request — expect a call inside market hours.", "gold");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell
      current="/support"
      index="S / OTC Desk"
      title="The institutional desk."
      sub="Custom allocations above $100k, bullion swaps, laddered settlement, and spot-linked block pricing — quoted by a human trader."
      right={<span className="st" data-tone="gold" style={{ fontSize: 12 }}>TIER 3 · DESK HOURS 08:00–18:00 ET</span>}
    >
      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Request a quote</p>
          <form className="rm-form" onSubmit={submit}>
            <div className="rm-formrow">
              <div className="rm-field">
                <label className="rm-label" htmlFor="otc-notional">Notional (USD)</label>
                <input id="otc-notional" className="rm-input num" type="number" min={100000} step={50000} value={notional} onChange={(e) => setNotional(parseInt(e.target.value) || 100000)} />
              </div>
              <div className="rm-field">
                <label className="rm-label" htmlFor="otc-metal">Metal</label>
                <select id="otc-metal" className="rm-select" value={metal} onChange={(e) => setMetal(e.target.value)}>
                  <option value="gold">Gold · XAU</option>
                  <option value="silver">Silver · XAG</option>
                  <option value="platinum">Platinum · XPT</option>
                </select>
              </div>
            </div>
            <div className="rm-field">
              <label className="rm-label" htmlFor="otc-req">Structure</label>
              <textarea id="otc-req" className="rm-textarea" required value={request} onChange={(e) => setRequest(e.target.value)} placeholder="e.g. 400 oz laddered over two weeks, wire settlement, vault custody with quarterly audit letters." />
            </div>
            <button className="btn btn--gold btn--lg btn--block" type="submit" disabled={busy}>
              {busy ? "Dispatching…" : `Request quote · ${usd0(notional)} notional`}
            </button>
            <p className="rm-note num">Schedule a call instead: the desk dials within the hour during market hours.</p>
          </form>
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Your desk activity</p>
            <div className="rm-kv num">
              {mine.map((q) => (
                <div key={q.id}>
                  <span>{q.id} · {usd0(q.notionalUsd)} {q.metal}</span>
                  <b><span className="st" data-tone={q.status === "QUOTED" ? "gold" : q.status === "ACCEPTED" ? "ok" : "live"}>{q.status}{q.quotedPremiumPct != null ? ` · +${q.quotedPremiumPct}%` : ""}</span></b>
                </div>
              ))}
              {mine.length === 0 && <p className="rm-note">No desk requests on file.</p>}
            </div>
          </div>
          <div className="rm-panel">
            <p className="rm-panel__k">What the desk does</p>
            <div className="rm-kv">
              <div><span>Block pricing</span><b className="num">tighter than screen premium</b></div>
              <div><span>Bullion swaps</span><b className="num">metal-for-metal, assay-matched</b></div>
              <div><span>Settlement</span><b className="num">wire ladders · custody splits</b></div>
              <div><span>Coverage</span><b className="num">dedicated senior trader</b></div>
            </div>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

// ————— /support/claims —————

export function ClaimsClient() {
  const { db, session, act } = useRm();
  const { addToast } = useFintech();
  const router = useRouter();
  const [shipmentId, setShipmentId] = useState("");
  const [kind, setKind] = useState("Tamper-evident seal compromised");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const myShipments = (db?.shipments ?? []).filter((s) => !session || s.userId === session.userId);
  const myClaims = (db?.tickets ?? []).filter((t) => t.kind === "CLAIM" && (!session || t.userId === session.userId));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = session;
    if (!s) { router.push("/auth/sign-in"); return; }
    setBusy(true);
    try {
      await act("createTicket", {
        kind: "CLAIM", priority: "URGENT",
        subject: `Claim · ${kind}${shipmentId ? ` · ${shipmentId}` : ""}`,
        text: `${detail}\n\nPolicy: Lloyd's syndicate to $250M · shipment ${shipmentId || "n/a"}.`,
      });
      setDetail("");
      addToast("Claim dossier created", "Linked to the Lloyd's policy · claims specialist assigned with URGENT priority.", "gold");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell
      current="/support"
      index="S / Claims"
      title="Lloyd's claims portal."
      sub="Delivery damage or a compromised tamper seal? One click builds the insurance dossier against the $250M policy."
    >
      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Initiate a claim <span className="st" data-tone="loss">URGENT queue</span></p>
          <form className="rm-form" onSubmit={submit}>
            <div className="rm-field">
              <label className="rm-label" htmlFor="cl-shp">Shipment</label>
              <select id="cl-shp" className="rm-select num" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
                <option value="">Select a shipment…</option>
                {myShipments.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.contents.slice(0, 44)}</option>)}
              </select>
            </div>
            <div className="rm-field">
              <span className="rm-label">Claim type</span>
              <div className="seg" role="group">
                {["Tamper-evident seal compromised", "Delivery damage", "Loss in transit"].map((k) => (
                  <button key={k} type="button" className={`seg__opt${kind === k ? " is-on" : ""}`} onClick={() => setKind(k)}>{k}</button>
                ))}
              </div>
            </div>
            <div className="rm-field">
              <label className="rm-label" htmlFor="cl-detail">What happened</label>
              <textarea id="cl-detail" className="rm-textarea" required value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Seal barcode mismatch, photos of packaging, courier interaction — everything helps the adjuster." />
            </div>
            <button className="btn btn--gold btn--block" type="submit" disabled={busy}>{busy ? "Filing…" : "1-click claim initiation"}</button>
          </form>
        </div>

        <div className="rm-form">
          <div className="rm-panel rm-panel--well">
            <p className="rm-panel__k">Coverage</p>
            <div className="rm-kv num">
              <div><span>Underwriter</span><b>Lloyd&apos;s of London syndicate</b></div>
              <div><span>Limit</span><b className="ok">$250,000,000 aggregate</b></div>
              <div><span>Scope</span><b>vault · transit · doorstep to signature</b></div>
              <div><span>Median payout</span><b>9 business days</b></div>
            </div>
          </div>
          <div className="rm-panel">
            <p className="rm-panel__k">Your claim dossiers</p>
            <div className="rm-kv num">
              {myClaims.map((c) => (
                <div key={c.id}>
                  <span><Link href={`/support/tickets/${c.id}`} style={{ color: "var(--gold-ink)" }}>{c.id}</Link> · {c.subject.replace("Claim · ", "")}</span>
                  <b><span className="st" data-tone={c.status === "RESOLVED" ? "ok" : "loss"}>{c.status.replace("_", " ")}</span></b>
                </div>
              ))}
              {myClaims.length === 0 && <p className="rm-note">No claims on file — the seals are holding.</p>}
            </div>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}
