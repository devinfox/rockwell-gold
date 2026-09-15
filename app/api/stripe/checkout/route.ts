// Card rail, step 1: turn a PENDING_PAYMENT card order into a hosted Stripe
// Checkout session and hand the browser its URL.
//
// GET  /api/stripe/checkout            → { configured }   (lets the UI grey out the card rail)
// POST /api/stripe/checkout {orderId}  → { url }
//
// Gated on the signed session cookie; the order must belong to the caller.
// An open session that already exists for the order is reused, so a customer
// who backed out of Stripe and returns is not left with several live sessions.

import type { NextRequest } from "next/server";
import { attachStripeSession, getDb, openDb, transact } from "../../../lib/rm-db";
import { StoreUnavailable } from "../../../lib/rm-store";
import { readSession } from "../../../lib/session";
import { createCheckoutSession, publicOrigin, stripe, stripeConfigured, StripeNotConfigured } from "../../../lib/stripe";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number, code = "REJECTED") =>
  Response.json({ ok: false, error, code }, { status, headers: noStore });

export async function GET() {
  return Response.json({ ok: true, configured: stripeConfigured() }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const claims = await readSession();
  if (!claims) return fail("Sign in to continue.", 401, "FORBIDDEN");

  let body: { orderId?: unknown };
  try {
    body = (await request.json()) as { orderId?: unknown };
  } catch {
    return fail("Malformed request.", 400, "INVALID");
  }
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId || orderId.length > 32) return fail("Missing order.", 400, "INVALID");

  try {
    await openDb({ maxAgeMs: 1500 });
  } catch (e) {
    console.error("[api/stripe/checkout] ledger store unavailable —", e);
    return fail("The ledger is temporarily unavailable. Please try again shortly.", 503, "STORE_UNAVAILABLE");
  }

  const db = getDb();
  const user = db.users.find((u) => u.id === claims.uid);
  if (!user || user.frozen) return fail("Session no longer valid.", 401, "FORBIDDEN");
  const order = db.orders.find((o) => o.id === orderId && o.userId === user.id);
  if (!order) return fail("No such order.", 404, "NOT_FOUND");
  if (order.payMethod !== "CARD") return fail("This order settles by bank wire, not card.", 400, "WRONG_RAIL");
  if (order.status === "CANCELLED") return fail("This order was cancelled.", 400, "CANCELLED");
  if (order.status !== "PENDING_PAYMENT") return fail("This order is already paid.", 400, "ALREADY_PAID");

  try {
    // Reuse a still-open session rather than minting another.
    if (order.stripeSessionId) {
      const existing = await stripe().checkout.sessions.retrieve(order.stripeSessionId);
      if (existing.status === "open" && existing.url) {
        return Response.json({ ok: true, url: existing.url, sessionId: existing.id }, { headers: noStore });
      }
    }

    const session = await createCheckoutSession(order, { origin: publicOrigin(request), customerEmail: user.email });
    if (!session.url) return fail("Stripe did not return a checkout URL.", 502, "STRIPE");

    await transact(() => attachStripeSession(order.id, session.id));
    return Response.json({ ok: true, url: session.url, sessionId: session.id }, { headers: noStore });
  } catch (e) {
    if (e instanceof StripeNotConfigured) return fail(e.message, 503, "NOT_CONFIGURED");
    if (e instanceof StoreUnavailable) return fail("The ledger is temporarily unavailable. Please try again shortly.", 503, "STORE_UNAVAILABLE");
    console.error("[api/stripe/checkout] failed —", e);
    return fail("Could not start card settlement. Please try again.", 502, "STRIPE");
  }
}
