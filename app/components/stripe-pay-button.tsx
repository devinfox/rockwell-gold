"use client";

// Card rail entry point shared by checkout, the success page and the order
// page: asks /api/stripe/checkout for the hosted Checkout URL for an order
// and sends the browser there. The amount charged is the ledger's, never the
// page's (see app/lib/stripe.ts).

import React, { useState } from "react";

export async function startStripeCheckout(orderId: string): Promise<string> {
  const res = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  let json: { ok?: boolean; url?: string; error?: string } = {};
  try { json = await res.json(); } catch { /* fall through to the generic error */ }
  if (!res.ok || !json.ok || !json.url) throw new Error(json.error || "Could not start card settlement. Please try again.");
  return json.url;
}

export default function StripePayButton({
  orderId, label = "Pay by card · Stripe secure checkout", className = "btn btn--gold", style,
}: { orderId: string; label?: string; className?: string; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      window.location.assign(await startStripeCheckout(orderId));
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Could not start card settlement.");
    }
  };
  return (
    <>
      <button type="button" className={className} style={style} disabled={busy} onClick={go}>
        {busy ? "Opening Stripe…" : label}
      </button>
      {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)", marginTop: 8 }}>{err}</p>}
    </>
  );
}
