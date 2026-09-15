// Card rail, step 2: Stripe tells us the session was paid and the ledger
// settles the order (PAID → IN_ASSAY → ALLOCATED / FULFILLMENT_QUEUE).
//
// POST /api/stripe/webhook — called by Stripe, authenticated by the signature
// over the raw body (STRIPE_WEBHOOK_SECRET). No session cookie is involved.
//
// Stripe retries any non-2xx for up to three days, so: a transient ledger
// failure returns 500 (retry me), while a domain refusal (unknown order, amount
// mismatch, cancelled order) is logged loudly and returns 200 (retrying will
// not change the answer — a human has to look).
//
// Local development: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
// prints the whsec_… to put in .env.local.

import type Stripe from "stripe";
import { recordCardPayment } from "../../../lib/rm-db";
import { transact } from "../../../lib/rm-db";
import { OrderError } from "../../../lib/order-pricing";
import { orderIdOf, paymentIntentIdOf, stripe, StripeNotConfigured } from "../../../lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set — refusing unsigned events.");
    return new Response("Webhook not configured", { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  // The raw text is what the signature covers; parsing first would break it.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    if (e instanceof StripeNotConfigured) return new Response(e.message, { status: 503 });
    console.warn("[stripe/webhook] signature verification failed —", e instanceof Error ? e.message : e);
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.payment_status !== "paid") {
        // Delayed-notification methods land later as async_payment_succeeded.
        return Response.json({ received: true, deferred: true });
      }
      return settle(session, event.id);
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object;
      console.warn(`[stripe/webhook] ${event.type} for order ${orderIdOf(session)} (session ${session.id})`);
      return Response.json({ received: true });
    }
    default:
      return Response.json({ received: true, ignored: event.type });
  }
}

async function settle(session: Stripe.Checkout.Session, eventId: string): Promise<Response> {
  const orderId = orderIdOf(session);
  const paymentIntentId = paymentIntentIdOf(session);
  if (!orderId || !paymentIntentId) {
    console.error(`[stripe/webhook] ${eventId}: session ${session.id} carries no order/payment reference`);
    return Response.json({ received: true, error: "no order reference" });
  }
  try {
    const order = await transact(() =>
      recordCardPayment({
        orderId,
        paymentIntentId,
        amountCents: session.amount_total ?? -1,
        currency: session.currency ?? "",
        by: "stripe",
      }),
    );
    return Response.json({ received: true, orderId: order.id, status: order.status });
  } catch (e) {
    if (e instanceof OrderError) {
      console.error(`[stripe/webhook] ${eventId}: refused for ${orderId} — ${e.code}: ${e.message}`);
      return Response.json({ received: true, refused: e.code });
    }
    console.error(`[stripe/webhook] ${eventId}: ledger failure for ${orderId} —`, e);
    return new Response("Ledger unavailable", { status: 500 });
  }
}
