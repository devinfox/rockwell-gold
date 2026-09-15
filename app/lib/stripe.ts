import "server-only";

// Stripe wiring for the card rail.
//
// Card orders are created on the ledger at PENDING_PAYMENT (placeOrder), then
// the customer is sent to a hosted Stripe Checkout session built from the
// server-priced order. Stripe never sees a client-side number: every line item
// is taken from the Order record the ledger already holds. Settlement lands
// through the webhook (app/api/stripe/webhook) and, as a belt-and-braces path
// for local development without the Stripe CLI, through /api/stripe/verify on
// the success page.
//
// Required env:
//   STRIPE_SECRET_KEY       sk_test_… / sk_live_…   (Dashboard → Developers → API keys)
//   STRIPE_WEBHOOK_SECRET   whsec_…                 (Dashboard → Developers → Webhooks, or `stripe listen`)

import Stripe from "stripe";
import type { Order } from "./rm-types";

export class StripeNotConfigured extends Error {
  constructor() {
    super("Card settlement is not configured on this environment (STRIPE_SECRET_KEY is missing).");
    this.name = "StripeNotConfigured";
  }
}

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY?.trim();
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeNotConfigured();
  if (!client) client = new Stripe(key, { appInfo: { name: "rockwell-gold", url: process.env.NEXT_PUBLIC_SITE_URL } });
  return client;
}

/** Stripe's minimum Checkout session lifetime. The order price is already fixed on the ledger. */
export const CHECKOUT_SESSION_TTL_S = 30 * 60;

export const toCents = (usd: number) => Math.round(usd * 100);

/**
 * Builds a hosted Checkout session for a PENDING_PAYMENT card order. Line items
 * come from the ledger record, and their sum is checked against the order total
 * so a cent of float drift can never produce a charge that differs from what
 * the customer executed.
 */
export async function createCheckoutSession(order: Order, opts: { origin: string; customerEmail?: string }): Promise<Stripe.Checkout.Session> {
  const totalCents = toCents(order.totalUsd);
  let line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((it) => ({
    quantity: it.quantity,
    price_data: {
      currency: "usd",
      unit_amount: toCents(it.unitPriceUsd),
      product_data: {
        name: it.title,
        description: `${it.mint} · SKU ${it.sku}`,
        ...(it.image.startsWith("https://") ? { images: [it.image] } : {}),
        metadata: { sku: it.sku, productId: it.productId },
      },
    },
  }));
  const lineSum = line_items.reduce((a, li) => a + (li.price_data?.unit_amount ?? 0) * (li.quantity ?? 0), 0);
  if (lineSum !== totalCents) {
    line_items = [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: totalCents,
        product_data: { name: `Rockwell Metals order ${order.id}`, description: order.items.map((i) => `${i.title} ×${i.quantity}`).join(" · ") },
      },
    }];
  }

  return stripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items,
    client_reference_id: order.id,
    metadata: { orderId: order.id, userId: order.userId, custody: order.custody },
    payment_intent_data: {
      description: `Rockwell Metals · ${order.id}`,
      metadata: { orderId: order.id, userId: order.userId },
    },
    ...(opts.customerEmail ? { customer_email: opts.customerEmail } : {}),
    success_url: `${opts.origin}/checkout/success/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.origin}/orders/${order.id}?payment=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_S,
  });
}

/** The payment intent id on a session, whether Stripe returned it expanded or not. */
export function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

export function orderIdOf(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.orderId || session.client_reference_id || null;
}

/** Public origin for Stripe's return URLs: the configured site in production, the request origin otherwise. */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && configured) return configured;
  return new URL(request.url).origin;
}
