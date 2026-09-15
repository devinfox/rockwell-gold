// Card rail, fallback: the success page asks whether its Checkout session is
// paid and, if so, settles the order right away. Covers the gap before the
// webhook arrives and local development where no webhook is forwarded.
//
// GET /api/stripe/verify?session_id=cs_…  → { paid, status, order? }
//
// Gated on the session cookie; the session's order must belong to the caller.
// Idempotent with the webhook — recordCardPayment is a no-op once paid.

import type { NextRequest } from "next/server";
import { getDb, openDb, recordCardPayment, transact } from "../../../lib/rm-db";
import { OrderError } from "../../../lib/order-pricing";
import { StoreUnavailable } from "../../../lib/rm-store";
import { readSession } from "../../../lib/session";
import { orderIdOf, paymentIntentIdOf, stripe, StripeNotConfigured } from "../../../lib/stripe";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number, code = "REJECTED") =>
  Response.json({ ok: false, error, code }, { status, headers: noStore });

export async function GET(request: NextRequest) {
  const claims = await readSession();
  if (!claims) return fail("Sign in to continue.", 401, "FORBIDDEN");

  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim() ?? "";
  if (!/^cs_[A-Za-z0-9_]{8,}$/.test(sessionId)) return fail("Missing checkout session.", 400, "INVALID");

  try {
    await openDb({ maxAgeMs: 1500 });
  } catch (e) {
    console.error("[api/stripe/verify] ledger store unavailable —", e);
    return fail("The ledger is temporarily unavailable.", 503, "STORE_UNAVAILABLE");
  }

  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const orderId = orderIdOf(session);
    const order = orderId ? getDb().orders.find((o) => o.id === orderId && o.userId === claims.uid) : null;
    if (!order) return fail("No such order.", 404, "NOT_FOUND");

    if (session.payment_status !== "paid") {
      return Response.json({ ok: true, paid: false, status: session.status, orderId: order.id }, { headers: noStore });
    }
    const paymentIntentId = paymentIntentIdOf(session);
    if (!paymentIntentId) return fail("Stripe reported no payment on this session.", 502, "STRIPE");

    const settled = await transact(() =>
      recordCardPayment({
        orderId: order.id,
        paymentIntentId,
        amountCents: session.amount_total ?? -1,
        currency: session.currency ?? "",
        by: "stripe",
      }),
    );
    return Response.json({ ok: true, paid: true, status: session.status, orderId: settled.id, orderStatus: settled.status }, { headers: noStore });
  } catch (e) {
    if (e instanceof StripeNotConfigured) return fail(e.message, 503, "NOT_CONFIGURED");
    if (e instanceof OrderError) return fail(e.message, 400, e.code);
    if (e instanceof StoreUnavailable) return fail("The ledger is temporarily unavailable.", 503, "STORE_UNAVAILABLE");
    console.error("[api/stripe/verify] failed —", e);
    return fail("Could not confirm the payment. Your order is safe — check /orders in a moment.", 502, "STRIPE");
  }
}
