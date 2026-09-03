"use client";

// Remaining admin tools (blueprint §2.2): sell-back liquidity desk,
// Customer 360 CRM, pricing engine, compliance/KYC/AML center,
// staff support desk, OTC quote generator, and the audit ledger.

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OpsShell } from "./ops-shell";
import { useRm, usd, usd0, ago, fmtDateTime } from "../lib/use-rm";
import { useSpot } from "../components/use-spot";
import { useConfirm } from "../components/confirm-dialog";
import { ROLE_LABEL, TIER_LIMIT, type KycStatus, type KycTier, type Role } from "../lib/rm-types";
import { useActionRunner } from "./use-action-runner";

const ROLE_OPTIONS: Role[] = ["CUSTOMER", "SUPPORT", "LOGISTICS", "OPS_VAULT", "COMPLIANCE", "SUPER_ADMIN"];

// ————— /admin/sell-backs —————

export function AdminSellbacksClient() {
  const rm = useRm(4000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, confirmElement } = useConfirm();
  const gate = { disabled: !!busy || !runner.can("sellbackTransition"), title: runner.why("sellbackTransition") };

  const move = async (id: string, status: string, prompt?: { title: string; body: React.ReactNode; destructive?: boolean }) => {
    if (prompt && !(await confirm({ ...prompt, confirmLabel: status === "REJECTED" ? "Reject" : "Confirm" }))) return;
    setBusy(id + status);
    try { await runner.run("sellbackTransition", { id, status }); } finally { setBusy(null); }
  };

  return (
    <OpsShell rm={rm} current="/admin/sell-backs" title="Inbound liquidity desk.">
      {confirmElement}
      <p className="rm-sub" style={{ marginBottom: 18 }}>
        Customer liquidations at locked bid rates. Approval checks KYC clearance; disbursement executes the payout and reclaims physical stock to treasury.
      </p>
      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Request</th><th>Customer</th><th>Position</th><th className="r">Locked bid</th><th>Payout</th><th>KYC</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(db?.sellbacks ?? []).map((s) => {
              const u = db?.users.find((x) => x.id === s.userId);
              const totalPayout = s.lockedBidUsd * s.quantity;
              return (
                <tr key={s.id}>
                  <td className="num"><b>{s.id}</b><div className="rm-cellmain"><span>{ago(s.createdAt)}</span></div></td>
                  <td>{u?.fullName}</td>
                  <td><div className="rm-cellmain"><b>{s.title} ×{s.quantity}</b><span className="num">{s.serials.join(" · ")}</span></div></td>
                  <td className="r num"><b>{usd(totalPayout)}</b><div className="rm-cellmain"><span>spread {s.spreadPct}%</span></div></td>
                  <td className="num">{s.payout}{s.payoutRef ? <div className="rm-cellmain"><span>{s.payoutRef}</span></div> : null}</td>
                  <td><span className="st" data-tone={u?.kycStatus === "CLEARED" ? "ok" : "warn"}>{u?.kycStatus ?? "—"}</span></td>
                  <td><span className="st" data-tone={s.status === "DISBURSED" ? "ok" : s.status === "REJECTED" ? "loss" : s.status === "APPROVED" ? "gold" : "warn"}>{s.status}</span></td>
                  <td>
                    <div className="rm-actions" style={{ flexWrap: "nowrap" }}>
                      {s.status === "REQUESTED" && (
                        <>
                          <button className="btn btn--ghost" style={{ padding: "5px 10px", fontSize: 12 }} {...gate} onClick={() => move(s.id, "APPROVED", { title: "Approve sell-back", body: <>Approve <b>{s.id}</b> for <b>{u?.fullName}</b> — {s.title} ×{s.quantity} at {usd(totalPayout)}?</> })}>Approve</button>
                          <button className="btn btn--ghost" style={{ padding: "5px 10px", fontSize: 12, color: "var(--loss)" }} {...gate} onClick={() => move(s.id, "REJECTED", { title: "Reject sell-back", body: <>Reject <b>{s.id}</b> from <b>{u?.fullName}</b>? Their serials return to vaulted status.</>, destructive: true })}>Reject</button>
                        </>
                      )}
                      {s.status === "APPROVED" && (
                        <button className="btn btn--gold" style={{ padding: "5px 12px", fontSize: 12 }} {...gate} onClick={() => move(s.id, "DISBURSED", { title: "Confirm disbursement", body: <>Pay <b>{usd(totalPayout)}</b> to <b>{u?.fullName}</b> via <b>{s.payout}</b> and reclaim {s.serials.length} serial(s) to treasury. This cannot be undone.</> })}>
                          {s.payout === "USDC" ? "1-click crypto payout" : "Fedwire export · pay"}
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
    </OpsShell>
  );
}

// ————— /admin/customers —————

export function AdminCustomersClient() {
  const rm = useRm();
  const router = useRouter();
  const { db } = rm;
  const [q, setQ] = useState("");

  const customers = (db?.users ?? []).filter((u) => u.role === "CUSTOMER" && (!q || `${u.fullName} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  const gmvOf = (id: string) => (db?.orders ?? []).filter((o) => o.userId === id && o.status !== "CANCELLED").reduce((a, o) => a + o.totalUsd, 0);
  const ozOf = (id: string) => (db?.holdings ?? []).filter((h) => h.userId === id && h.status === "VAULTED").reduce((a, h) => a + h.weightOz, 0);

  return (
    <OpsShell rm={rm} current="/admin/customers" title="Customer 360.">
      <div className="ops-filters">
        <input className="rm-input" placeholder="Search name, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ops-filters__count num">{customers.length} clients</span>
      </div>
      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Client</th><th>KYC tier</th><th className="r">Lifetime GMV</th><th className="r">Vault oz</th><th>Risk</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {customers.map((u) => (
              <tr key={u.id} className="rm-rowlink" onClick={() => router.push(`/admin/customers/${u.id}`)}>
                <td><div className="rm-cellmain"><b><Link href={`/admin/customers/${u.id}`} style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()}>{u.fullName}</Link></b><span className="num">{u.email} · {u.accountType.toLowerCase()}</span></div></td>
                <td><span className="st" data-tone={u.kycTier === "TIER_3" ? "gold" : u.kycTier === "TIER_2" ? "ok" : "muted"}>{u.kycTier.replace("_", " ")}</span></td>
                <td className="r num"><b>{usd0(gmvOf(u.id))}</b></td>
                <td className="r num">{ozOf(u.id).toFixed(2)}</td>
                <td><span className="st" data-tone={u.riskRating === "LOW" ? "ok" : u.riskRating === "MEDIUM" ? "warn" : "loss"}>{u.riskRating}</span></td>
                <td><span className="st" data-tone={u.frozen ? "loss" : "ok"}>{u.frozen ? "FROZEN" : "Active"}</span></td>
                <td className="num" style={{ color: "var(--gold-ink)" }}>→</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OpsShell>
  );
}

// ————— /admin/customers/[id] —————

export function AdminCustomerDossierClient({ userId }: { userId: string }) {
  const rm = useRm(5000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const u = db?.users.find((x) => x.id === userId);
  // Draft role for the selector; falls back to the account's current role.
  const [roleDraft, setRoleDraft] = useState<Role | null>(null);
  const role: Role = roleDraft ?? u?.role ?? "CUSTOMER";
  const setRole = (r: Role) => setRoleDraft(r);

  const orders = (db?.orders ?? []).filter((o) => o.userId === userId);
  const holdings = (db?.holdings ?? []).filter((h) => h.userId === userId);
  const gmv = orders.filter((o) => o.status !== "CANCELLED").reduce((a, o) => a + o.totalUsd, 0);

  return (
    <OpsShell rm={rm} current="/admin/customers" title={u ? `Dossier · ${u.fullName}` : "Dossier"}>
      {!u ? (
        <p className="rm-sub">Unknown customer. <Link href="/admin/customers" style={{ color: "var(--gold-ink)" }}>← Directory</Link></p>
      ) : (
        <div className="rm-grid2">
          <div className="rm-form">
            <div className="rm-panel rm-panel--well">
              <p className="rm-panel__k">Identity <span className="st" data-tone={u.kycStatus === "CLEARED" ? "ok" : "warn"}>{u.kycStatus}</span></p>
              <div className="rm-kv num">
                <div><span>Name</span><b>{u.fullName}</b></div>
                <div><span>Email / phone</span><b>{u.email} · {u.phone}</b></div>
                <div><span>Type</span><b>{u.accountType}</b></div>
                <div><span>KYC tier</span><b>{u.kycTier.replace("_", " ")} · {TIER_LIMIT[u.kycTier]}</b></div>
                <div><span>ID documents</span><b className="ok">encrypted viewer · 2 on file</b></div>
                <div><span>Linked rails</span><b>USDC wallet (whitelisted) · Chase ****4417</b></div>
                <div><span>Lifetime GMV</span><b style={{ color: "var(--gold-ink)" }}>{usd0(gmv)}</b></div>
              </div>
              <div className="rm-actions" style={{ marginTop: 14 }}>
                {/* Freeze is Compliance/Super-admin only; the dossier keeps its inline
                    error line, and the runner adds the toast + role pre-check. */}
                <button className="btn btn--ghost" style={{ color: u.frozen ? "var(--gain)" : "var(--loss)" }}
                  disabled={busy || !runner.can("freezeCustomer")} title={runner.why("freezeCustomer")}
                  onClick={async () => {
                    setBusy(true); setActionErr(null);
                    try {
                      const r = await runner.run("freezeCustomer", { userId: u.id, frozen: !u.frozen });
                      if (!r.ok) setActionErr(r.error);
                    } finally { setBusy(false); }
                  }}>
                  {u.frozen ? "Unfreeze account" : "Freeze account"}
                </button>
              </div>
              {runner.can("setRole") && rm.session?.userId !== u.id && (
                <form
                  className="scan__row"
                  style={{ marginTop: 12 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (role === u.role) return;
                    setBusy(true);
                    setActionErr(null);
                    try {
                      const r = await runner.run("setRole", { userId: u.id, role });
                      if (r.ok) setRoleDraft(null); else setActionErr(r.error);
                    } finally { setBusy(false); }
                  }}
                >
                  <select className="rm-input" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Account role">
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button className="btn btn--ghost" type="submit" disabled={busy || role === u.role}>Set role</button>
                </form>
              )}
              {runner.can("resetPassword") && rm.session?.userId !== u.id && (
                <div style={{ marginTop: 12 }}>
                  {tempPassword ? (
                    <div className="rm-panel rm-panel--well" role="status">
                      <p className="rm-panel__k">One-time temporary password</p>
                      <p className="num" style={{ fontSize: 18, letterSpacing: "0.04em", margin: "6px 0" }}><b>{tempPassword}</b></p>
                      <p className="rm-note">Shown once and not stored. Relay it to the customer over a verified channel; they must choose a new password on sign-in. This reset is on the audit ledger under your name.</p>
                      <button className="btn btn--ghost" type="button" onClick={() => setTempPassword(null)}>Dismiss</button>
                    </div>
                  ) : (
                    <button
                      className="btn btn--ghost"
                      type="button"
                      disabled={busy}
                      title="Issue a one-time temporary password after verifying the customer's identity"
                      onClick={async () => {
                        if (!window.confirm(`Issue a one-time temporary password for ${u.fullName} (${u.email})? Their current password stops working immediately.`)) return;
                        setBusy(true);
                        setActionErr(null);
                        try {
                          const r = await runner.run<{ temporaryPassword: string }>("resetPassword", { userId: u.id });
                          if (r.ok) setTempPassword(r.result.temporaryPassword); else setActionErr(r.error);
                        } finally { setBusy(false); }
                      }}
                    >
                      Reset password (support desk)
                    </button>
                  )}
                </div>
              )}
              {actionErr && <p className="rm-note" role="alert" style={{ color: "var(--loss)", marginTop: 8 }}>{actionErr}</p>}
            </div>

            <div className="rm-panel">
              <p className="rm-panel__k">Staff notes</p>
              <div className="rm-kv">
                {u.staffNotes.map((n, i) => <div key={i}><span style={{ maxWidth: "100%" }}>{n}</span><b></b></div>)}
                {u.staffNotes.length === 0 && <p className="rm-note">No notes on file.</p>}
              </div>
              <form className="scan__row" style={{ marginTop: 12 }} onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; setBusy(true); try { const r = await runner.run("addStaffNote", { userId: u.id, note }); if (r.ok) setNote(""); } finally { setBusy(false); } }}>
                <input className="rm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a dossier note…" />
                <button className="btn btn--ghost" type="submit" disabled={busy || !note.trim() || !runner.can("addStaffNote")} title={runner.why("addStaffNote")}>Add</button>
              </form>
            </div>
          </div>

          <div className="rm-form">
            <div className="rm-panel">
              <p className="rm-panel__k">Trade history <span className="num">{orders.length} orders</span></p>
              <div className="rm-kv num">
                {orders.map((o) => (
                  <div key={o.id}>
                    <span><Link href={`/admin/orders/${o.id}`} style={{ color: "var(--gold-ink)" }}>{o.id}</Link> · {o.items[0]?.sku} ×{o.items.reduce((a, i) => a + i.quantity, 0)}</span>
                    <b>{usd0(o.totalUsd)} · {o.status}</b>
                  </div>
                ))}
                {orders.length === 0 && <p className="rm-note">No orders.</p>}
              </div>
            </div>
            <div className="rm-panel">
              <p className="rm-panel__k">Vault balance <span className="num">{holdings.filter((h) => h.status === "VAULTED").reduce((a, h) => a + h.weightOz, 0).toFixed(2)} oz</span></p>
              <div className="rm-kv num">
                {holdings.map((h) => (
                  <div key={h.id}>
                    <span>{h.serialNumber} · {h.title.slice(0, 30)}</span>
                    <b><span className="st" data-tone={h.status === "VAULTED" ? "ok" : h.status === "SOLD_BACK" ? "muted" : "live"}>{h.status.replace("_", " ")}</span></b>
                  </div>
                ))}
                {holdings.length === 0 && <p className="rm-note">Nothing vaulted.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </OpsShell>
  );
}

// ————— /admin/pricing-engine —————

function PricingField({ k, label, value, step = 0.1, suffix = "%", draft, setDraft }: {
  k: string; label: string; value: number; step?: number; suffix?: string;
  draft: Record<string, number> | null;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, number> | null>>;
}) {
  return (
    <div className="rm-field">
      <label className="rm-label" htmlFor={`pe-${k}`}>{label} <span className="hint num">{suffix}</span></label>
      <input id={`pe-${k}`} className="rm-input num" type="number" step={step} value={draft?.[k] ?? value}
        onChange={(e) => setDraft((d) => ({ ...(d ?? {}), [k]: parseFloat(e.target.value) || 0 }))} />
    </div>
  );
}

export function PricingEngineClient() {
  const rm = useRm();
  const spot = useSpot();
  const xau = spot?.prices?.XAU ?? 0;
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const p = db?.pricing;
  const canPublish = runner.can("updatePricing");

  const val = (k: string, fallback: number) => draft?.[k] ?? fallback;

  const save = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const r = await runner.run("updatePricing", {
        settings: {
          basePremiumPct: { gold: val("gold", p.basePremiumPct.gold), silver: val("silver", p.basePremiumPct.silver), platinum: val("platinum", p.basePremiumPct.platinum) },
          tierDiscounts: { qty5: val("qty5", p.tierDiscounts.qty5 * 100) / 100, qty20: val("qty20", p.tierDiscounts.qty20 * 100) / 100 },
          surcharges: { crypto: 0, wire: val("wire", p.surcharges.wire * 100) / 100, card: val("card", p.surcharges.card * 100) / 100 },
          sellbackSpreadPct: val("spread", p.sellbackSpreadPct),
          loyaltyDiscountPct: val("loyalty", p.loyaltyDiscountPct),
        },
      }, { success: "Live pricing multipliers published." });
      if (r.ok) setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsShell rm={rm} current="/admin/pricing-engine" title="Margin & spread manager.">
      {p && (
        <div className="rm-grid2">
          <div className="rm-panel">
            <p className="rm-panel__k">Live pricing formula <span className="st" data-tone="live">applies on next tick</span></p>
            <div className="rm-form">
              <div className="rm-formrow">
                <PricingField k="gold" label="Gold base premium" value={p.basePremiumPct.gold} draft={draft} setDraft={setDraft} />
                <PricingField k="silver" label="Silver base premium" value={p.basePremiumPct.silver} draft={draft} setDraft={setDraft} />
              </div>
              <div className="rm-formrow">
                <PricingField k="platinum" label="Platinum base premium" value={p.basePremiumPct.platinum} draft={draft} setDraft={setDraft} />
                <PricingField k="spread" label="Sell-back spread" value={p.sellbackSpreadPct} step={0.05} draft={draft} setDraft={setDraft} />
              </div>
              <div className="rm-formrow">
                <PricingField k="qty5" label="Volume tier · 5–19" value={p.tierDiscounts.qty5 * 100} step={0.25} suffix="% off" draft={draft} setDraft={setDraft} />
                <PricingField k="qty20" label="Volume tier · 20+" value={p.tierDiscounts.qty20 * 100} step={0.25} suffix="% off" draft={draft} setDraft={setDraft} />
              </div>
              <div className="rm-formrow">
                <PricingField k="wire" label="Wire surcharge" value={p.surcharges.wire * 100} step={0.1} draft={draft} setDraft={setDraft} />
                <PricingField k="card" label="Card surcharge" value={p.surcharges.card * 100} step={0.1} draft={draft} setDraft={setDraft} />
              </div>
              <PricingField k="loyalty" label="Sovereign-tier loyalty discount" value={p.loyaltyDiscountPct} step={0.05} draft={draft} setDraft={setDraft} />
              <button className="btn btn--gold btn--lg btn--block" type="button" disabled={busy || !draft || !canPublish} title={runner.why("updatePricing")} onClick={save}>
                {busy ? "Publishing multipliers…" : !canPublish ? "Read-only · Super Admin publishes" : draft ? "Publish to live pricing" : "No changes"}
              </button>
            </div>
          </div>

          <div className="rm-form">
            <div className="rm-panel rm-panel--well">
              <p className="rm-panel__k">Feed configuration</p>
              <div className="rm-kv num">
                <div><span>Spot feed</span><b>{p.spotFeed}</b></div>
                <div><span>Crypto surcharge</span><b className="ok">0% · locked by charter</b></div>
                <div><span>Last publish</span><b>{fmtDateTime(p.updatedAt)} · {p.updatedBy}</b></div>
              </div>
            </div>
            <div className="rm-panel">
              <p className="rm-panel__k">Formula preview · 1 oz gold</p>
              <div className="rm-kv num">
                <div><span>Spot XAU{spot && !spot.live ? " (indicative)" : ""}</span><b>{xau ? usd(xau) : "—"}</b></div>
                <div><span>+ base premium {val("gold", p.basePremiumPct.gold)}%</span><b>{xau ? usd(xau * (1 + val("gold", p.basePremiumPct.gold) / 100)) : "—"}</b></div>
                <div><span>20+ tier</span><b>{xau ? usd(xau * (1 + val("gold", p.basePremiumPct.gold) / 100) * (1 - val("qty20", p.tierDiscounts.qty20 * 100) / 100)) : "—"}</b></div>
                <div><span>Card rail</span><b>{xau ? usd(xau * (1 + val("gold", p.basePremiumPct.gold) / 100) * (1 + val("card", p.surcharges.card * 100) / 100)) : "—"}</b></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </OpsShell>
  );
}

// ————— /admin/compliance —————

export function ComplianceClient() {
  const rm = useRm(5000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [busy, setBusy] = useState<string | null>(null);

  const queue = (db?.users ?? []).filter((u) => u.role === "CUSTOMER" && u.kycStatus !== "CLEARED");
  const big = (db?.orders ?? []).filter((o) => o.totalUsd > 10_000 && (o.payMethod === "CRYPTO" || o.payMethod === "WIRE") && o.status !== "CANCELLED");

  const setKyc = async (userId: string, kycStatus: KycStatus, kycTier?: KycTier) => {
    setBusy(userId);
    try { await runner.run("kycSet", { userId, kycStatus, kycTier }); } finally { setBusy(null); }
  };
  const kycGate = (userId: string) => ({ disabled: busy === userId || !runner.can("kycSet"), title: runner.why("kycSet") });

  return (
    <OpsShell rm={rm} current="/admin/compliance" title="Compliance & AML center.">
      <div className="rm-grid2">
        <div className="rm-panel">
          <p className="rm-panel__k">Identity review queue <span className="st" data-tone="warn">{queue.length} pending</span></p>
          <div className="rm-kv">
            {queue.map((u) => (
              <div key={u.id} style={{ alignItems: "center" }}>
                <span><Link href={`/admin/customers/${u.id}`} style={{ color: "var(--gold-ink)" }}>{u.fullName}</Link> <i className="num" style={{ fontStyle: "normal", fontSize: 11, color: "var(--text-muted)" }}>· {u.kycTier.replace("_", " ")} · {u.kycStatus}</i></span>
                <b>
                  <span className="rm-actions" style={{ flexWrap: "nowrap" }}>
                    <button className="btn btn--ghost" style={{ padding: "4px 10px", fontSize: 11.5 }} {...kycGate(u.id)} onClick={() => setKyc(u.id, "CLEARED", u.kycTier === "TIER_1" ? "TIER_2" : u.kycTier)}>Clear</button>
                    <button className="btn btn--ghost" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--loss)" }} {...kycGate(u.id)} onClick={() => setKyc(u.id, "FLAGGED")}>Flag · SAR</button>
                  </span>
                </b>
              </div>
            ))}
            {queue.length === 0 && <p className="rm-note">Queue clear — Persona/Stripe Identity webhooks are all resolved.</p>}
          </div>
        </div>

        <div className="rm-panel">
          <p className="rm-panel__k">FinCEN Form 8300 monitor <span className="num">cash/crypto &gt; $10k</span></p>
          <div className="rm-kv num">
            {big.map((o) => (
              <div key={o.id}>
                <span><Link href={`/admin/orders/${o.id}`} style={{ color: "var(--gold-ink)" }}>{o.id}</Link> · {db?.users.find((u) => u.id === o.userId)?.fullName}</span>
                <b>{usd0(o.totalUsd)} · <span className="st" data-tone="ok">8300 PDF generated</span></b>
              </div>
            ))}
            {big.length === 0 && <p className="rm-note">No threshold events this period.</p>}
          </div>
          <p className="rm-note num" style={{ marginTop: 12 }}>OFAC sanctions screening runs on every settlement · SAR drafts file to the secure drive.</p>
        </div>
      </div>

      <div className="rm-panel" style={{ marginTop: "var(--gap)" }}>
        <p className="rm-panel__k">Watch state</p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><p className="kpi__k">OFAC screens · 24h</p><p className="kpi__v num">142</p><p className="kpi__sub num">0 hits</p></div>
          <div className="kpi"><p className="kpi__k">8300 filings · MTD</p><p className="kpi__v num">{big.length}</p><p className="kpi__sub num">auto-generated PDF</p></div>
          <div className="kpi"><p className="kpi__k">SARs open</p><p className="kpi__v num">{(db?.users ?? []).filter((u) => u.kycStatus === "FLAGGED").length}</p><p className="kpi__sub num">under review</p></div>
          <div className="kpi"><p className="kpi__k">Frozen accounts</p><p className="kpi__v num">{(db?.users ?? []).filter((u) => u.frozen).length}</p><p className="kpi__sub num">risk holds</p></div>
        </div>
      </div>
    </OpsShell>
  );
}

// ————— /admin/support —————

export function AdminSupportClient() {
  const rm = useRm(4000);
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const tickets = db?.tickets ?? [];
  const t = tickets.find((x) => x.id === (active ?? tickets[0]?.id));
  const canSet = runner.can("ticketSet");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = rm.session;
    if (!t || !s || !reply.trim()) return;
    setBusy(true);
    try {
      const r = await runner.run("ticketReply", { id: t.id, text: reply });
      if (r.ok) setReply("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsShell rm={rm} current="/admin/support" title="Staff support desk.">
      <div className="rm-grid2 rm-grid2--narrow">
        <div className="rm-tablewrap">
          <table className="rm-table">
            <thead><tr><th>Ticket</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody>
              {tickets.map((x) => (
                <tr key={x.id} className="rm-rowlink" onClick={() => setActive(x.id)} style={x.id === t?.id ? { background: "var(--elevated)" } : undefined}>
                  <td><div className="rm-cellmain"><b className="num">{x.id}</b><span>{x.subject.slice(0, 42)}</span></div></td>
                  <td><span className="st" data-tone={x.priority === "URGENT" ? "loss" : x.priority === "HIGH" ? "warn" : "muted"}>{x.priority}</span></td>
                  <td><span className="st" data-tone={x.status === "RESOLVED" ? "ok" : x.status === "IN_PROGRESS" ? "live" : "warn"}>{x.status.replace("_", " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {t ? (
          <div className="rm-panel">
            <p className="rm-panel__k">
              {t.id} · {t.subject}
              <span className="rm-actions" style={{ flexWrap: "nowrap" }}>
                {t.status !== "RESOLVED" && (
                  <button className="btn btn--ghost" style={{ padding: "4px 10px", fontSize: 11.5 }} disabled={!canSet} title={runner.why("ticketSet")} onClick={() => runner.run("ticketSet", { id: t.id, status: "RESOLVED" })}>Resolve</button>
                )}
                <select className="rm-select num" style={{ width: "auto", padding: "4px 8px", fontSize: 11.5 }} value={t.priority} disabled={!canSet} title={runner.why("ticketSet")} onChange={(e) => runner.run("ticketSet", { id: t.id, priority: e.target.value })} aria-label="Priority">
                  {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}
                </select>
              </span>
            </p>
            <div className="thread" style={{ maxHeight: 380, overflowY: "auto" }}>
              {t.messages.map((m, i) => (
                <div key={i} className={`thread__msg ${m.staff ? "thread__msg--me" : "thread__msg--staff"}`}>
                  <div className="thread__meta num"><b>{m.fromName}{m.staff ? " · staff" : ""}</b><span>{ago(m.at)}</span></div>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
            <form className="scan__row" style={{ marginTop: 14 }} onSubmit={send}>
              <input className="rm-input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as staff — syncs to the customer thread live…" />
              <button className="btn btn--gold" type="submit" disabled={busy || !reply.trim()}>Send</button>
            </form>
          </div>
        ) : (
          <p className="rm-sub">Queue is clear.</p>
        )}
      </div>
    </OpsShell>
  );
}

// ————— /admin/support/otc-quotes —————

export function AdminOtcClient() {
  const rm = useRm();
  const { db } = rm;
  const runner = useActionRunner(rm);
  const [premium, setPremium] = useState(2.9);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <OpsShell rm={rm} current="/admin/support/otc-quotes" title="OTC quote generator.">
      <div className="rm-tablewrap">
        <table className="rm-table">
          <thead><tr><th>Request</th><th>Client</th><th>Structure</th><th className="r">Notional</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(db?.otcQuotes ?? []).map((q) => {
              const u = db?.users.find((x) => x.id === q.userId);
              return (
                <tr key={q.id}>
                  <td className="num"><b>{q.id}</b><div className="rm-cellmain"><span>{ago(q.createdAt)}</span></div></td>
                  <td><div className="rm-cellmain"><b>{u?.fullName}</b><span className="num">{u?.kycTier.replace("_", " ")}</span></div></td>
                  <td style={{ maxWidth: 320 }}>{q.requestText}</td>
                  <td className="r num"><b>{usd0(q.notionalUsd)}</b> {q.metal}</td>
                  <td><span className="st" data-tone={q.status === "QUOTED" ? "gold" : q.status === "ACCEPTED" ? "ok" : "live"}>{q.status}{q.quotedPremiumPct != null ? ` +${q.quotedPremiumPct}%` : ""}</span></td>
                  <td>
                    {q.status === "REQUESTED" && (
                      <div className="rm-actions" style={{ flexWrap: "nowrap", alignItems: "center" }}>
                        <input className="rm-input num" type="number" step={0.1} value={premium} onChange={(e) => setPremium(parseFloat(e.target.value) || 0)} style={{ width: 84, padding: "6px 8px" }} aria-label="Premium %" />
                        <button className="btn btn--gold" style={{ padding: "6px 12px", fontSize: 12 }} disabled={busy === q.id || !runner.can("quoteOtc")} title={runner.why("quoteOtc")}
                          onClick={async () => { setBusy(q.id); try { await runner.run("quoteOtc", { id: q.id, premiumPct: premium }); } finally { setBusy(null); } }}>
                          Lock quote · issue wire slip
                        </button>
                      </div>
                    )}
                    {q.wireInstructions && <p className="rm-note num" style={{ maxWidth: 260 }}>{q.wireInstructions}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rm-note num" style={{ marginTop: 12 }}>Locking a quote generates a high-volume custom checkout link with spot-linked pricing and custom wire instructions.</p>
    </OpsShell>
  );
}

// ————— /admin/audit-logs —————

export function AuditLogsClient() {
  const rm = useRm(6000);
  const { db } = rm;
  const [q, setQ] = useState("");

  const rows = (db?.audit ?? []).filter((a) => !q || `${a.action} ${a.actorName} ${a.resourceId}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <OpsShell rm={rm} current="/admin/audit-logs" title="Immutable event ledger.">
      <div className="ops-filters">
        <input className="rm-input" placeholder="Filter by action, actor, resource…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ops-filters__count num">{rows.length} entries · append-only</span>
      </div>
      <div className="rm-panel">
        <div className="audit">
          {rows.map((a) => (
            <div key={a.id} className="audit__row">
              <span className="audit__when num">{fmtDateTime(a.at)}</span>
              <span className="audit__what">
                <b>{a.action}</b> <span>· {a.resourceType} {a.resourceId} · {a.actorName} <i className="num" style={{ fontStyle: "normal", fontSize: 10.5, color: "var(--text-muted)" }}>({a.ip})</i></span>
              </span>
              <span className="audit__diff" title={`${a.before ?? "∅"} → ${a.after ?? "∅"}`}>
                {a.before ? `${a.before} → ` : ""}{a.after ?? ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </OpsShell>
  );
}
