import "server-only";

// Server-side order pricing (audit: Critical — "the server accepts whatever
// price the browser sends").
//
// placeOrder never stores a client price. Every line is re-priced here from
// the catalog + the quote engine, against either the spot marks bound in a
// valid price-lock token (honouring the 120 s freeze the customer saw) or the
// live mark. The client's expected total is only used to detect drift: if the
// server's figure differs beyond a cent-level tolerance the order is refused
// with PRICE_CHANGED so the UI re-quotes, and the customer never pays a number
// they did not see.

import { availOf } from "../data/catalog";
import { findProduct } from "../data/pdp-fill";
import { priceWithSpot } from "./pricing/live";
import { PAYMENT_RAILS } from "./pricing/rules";
import { spotFromClaims, verifyLockToken, LOCK_TTL_S } from "./pricing/lock-token";
import { getSpot, type SpotQuote } from "./spot";
import type { Custody, Drop, OrderItem, PayMethod, ShippingAddress } from "./rm-types";

export class OrderError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = "OrderError";
  }
}

export const PAY_METHODS: readonly PayMethod[] = ["WIRE", "CARD"];
export const CUSTODIES: readonly Custody[] = ["VAULT", "DELIVERY"];
export const MAX_LINES = 10;
export const MAX_QTY = 999;
/** Cent-level drift allowed between the client's expected total and the server's. */
export const TOLERANCE_ABS = 1.0;
export const TOLERANCE_FRAC = 0.0025;

export interface RawLine {
  productId?: unknown;
  quantity?: unknown;
}

export interface PriceOrderInput {
  items: unknown;
  payMethod: unknown;
  custody: unknown;
  /** Structured delivery address (preferred). */
  shipTo?: unknown;
  /** Legacy one-line address; accepted only when `shipTo` is absent. */
  address?: unknown;
  expectedTotalUsd?: unknown;
  lockToken?: unknown;
  /** Live drops are priced from the store, not the catalog. */
  drops: Drop[];
}

export interface PricedOrder {
  items: OrderItem[];
  totalUsd: number;
  spotAtLock: number;
  lockedUntil: string;
  payMethod: PayMethod;
  custody: Custody;
  address: string | null;
  shipTo: ShippingAddress | null;
  /** "lock" when a valid token fixed the marks, "live" otherwise. */
  pricedAgainst: "lock" | "live";
}

// ————— delivery address —————

const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/**
 * Validates a structured address for armored delivery. US addresses get a
 * state + ZIP check; other countries need a postal code and region. Throws
 * OrderError with a field-specific message so the form can point at it.
 */
export function parseShippingAddress(raw: unknown): ShippingAddress {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bad = (field: string, message: string) => new OrderError("BAD_ADDRESS", message, { field });

  const recipient = str(o.recipient, 80);
  if (recipient.length < 2 || !/[a-z]/i.test(recipient)) throw bad("recipient", "Enter the recipient's full name as it appears on their photo ID.");

  const street = str(o.street, 120);
  if (street.length < 5 || !/\d/.test(street)) throw bad("street", "Enter a street address with a house or building number.");
  if (/\b(p\.?\s*o\.?\s*box|post office box)\b/i.test(street)) throw bad("street", "Armored carriers cannot deliver to a P.O. Box.");

  const unit = str(o.unit, 40) || undefined;
  const city = str(o.city, 80);
  if (city.length < 2) throw bad("city", "Enter a city.");

  const country = (str(o.country, 2) || "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw bad("country", "Enter a two-letter country code.");

  let state = str(o.state, 40).toUpperCase();
  let postalCode = str(o.postalCode, 16).toUpperCase();
  if (country === "US") {
    if (!US_STATES.has(state)) throw bad("state", "Enter a two-letter US state (for example CA).");
    if (!/^\d{5}(-\d{4})?$/.test(postalCode)) throw bad("postalCode", "Enter a 5-digit ZIP code (ZIP+4 is fine).");
  } else {
    if (state.length < 2) throw bad("state", "Enter a state, province or region.");
    if (postalCode.length < 3) throw bad("postalCode", "Enter a postal code.");
  }

  const phone = str(o.phone, 32);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw bad("phone", "Enter a phone number the courier can reach on delivery day.");

  state = state.slice(0, 40);
  postalCode = postalCode.slice(0, 16);
  return { recipient, street, unit, city, state, postalCode, country, phone };
}

export function formatShippingAddress(a: ShippingAddress): string {
  const line1 = a.unit ? `${a.street}, ${a.unit}` : a.street;
  return `${a.recipient} · ${line1}, ${a.city}, ${a.state} ${a.postalCode}${a.country !== "US" ? `, ${a.country}` : ""}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const railMultiplier = (m: PayMethod) => (m === "CARD" ? PAYMENT_RAILS.card.multiplier : 1);

function parseLines(raw: unknown): { productId: string; quantity: number }[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new OrderError("EMPTY", "Add at least one item to the order.");
  if (raw.length > MAX_LINES) throw new OrderError("TOO_MANY_LINES", `Orders are limited to ${MAX_LINES} lines.`);
  const seen = new Set<string>();
  return raw.map((l: RawLine) => {
    const productId = typeof l?.productId === "string" ? l.productId.trim() : "";
    const quantity = typeof l?.quantity === "number" ? l.quantity : Number(l?.quantity);
    if (!productId || productId.length > 64) throw new OrderError("BAD_PRODUCT", "Each line needs a product.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new OrderError("BAD_QTY", `Quantity must be a whole number between 1 and ${MAX_QTY}.`);
    }
    if (seen.has(productId)) throw new OrderError("DUPLICATE_LINE", "Combine duplicate items into one line.");
    seen.add(productId);
    return { productId, quantity };
  });
}

function metalSymbol(metal: string): keyof SpotQuote["prices"] {
  return metal === "silver" ? "XAG" : metal === "platinum" ? "XPT" : metal === "palladium" ? "XPD" : "XAU";
}

export async function priceOrder(input: PriceOrderInput): Promise<PricedOrder> {
  const payMethod = String(input.payMethod ?? "").toUpperCase() as PayMethod;
  if (!PAY_METHODS.includes(payMethod)) throw new OrderError("BAD_RAIL", "Choose bank wire or card settlement.");
  const custody = String(input.custody ?? "").toUpperCase() as Custody;
  if (!CUSTODIES.includes(custody)) throw new OrderError("BAD_CUSTODY", "Choose vault storage or insured delivery.");

  let address: string | null = null;
  let shipTo: ShippingAddress | null = null;
  if (custody === "DELIVERY") {
    if (input.shipTo !== undefined && input.shipTo !== null) {
      shipTo = parseShippingAddress(input.shipTo);
      address = formatShippingAddress(shipTo);
    } else {
      address = typeof input.address === "string" ? input.address.trim().replace(/\s+/g, " ") : "";
      if (address.length < 12 || address.length > 240 || !/\d/.test(address)) {
        throw new OrderError("BAD_ADDRESS", "Enter a complete street address (number, street, city, state, ZIP) for armored delivery.");
      }
    }
  }

  const lines = parseLines(input.items);

  // Spot: the marks the customer locked, or the live mark.
  const claims = verifyLockToken(typeof input.lockToken === "string" ? input.lockToken : null);
  const spot = claims ? spotFromClaims(claims) : await getSpot();
  const pricedAgainst: PricedOrder["pricedAgainst"] = claims ? "lock" : "live";
  if (!claims && spot.hardStale) {
    throw new OrderError("SPOT_STALE", "Live pricing is paused while the spot feed refreshes. Try again in a moment.");
  }

  const mult = railMultiplier(payMethod);
  const items: OrderItem[] = [];
  let spotAtLock = 0;

  for (const line of lines) {
    const p = findProduct(line.productId);
    if (p) {
      const avail = availOf(p);
      if (avail.key === "notify" || avail.key === "out") {
        throw new OrderError("OUT_OF_STOCK", `${p.title} is out of stock.`, { productId: p.id });
      }
      const lp = priceWithSpot(p, spot, line.quantity);
      if (!lp || lp.mode === "enquire" || !(lp.cashPrice > 0)) {
        throw new OrderError("NOT_PURCHASABLE", `${p.title} is quote-only. Request a quote from the desk.`, { productId: p.id });
      }
      const unit = round2(lp.cashPrice * mult);
      items.push({
        productId: p.id, sku: p.sku, title: p.title, image: p.image, mint: p.mint,
        quantity: line.quantity, unitPriceUsd: unit,
        unitPremiumPct: round2(lp.premiumPct * 100),
        allocatedSerials: [], packedSerials: [], tebSeal: null,
      });
      if (!spotAtLock) spotAtLock = lp.spotUsed;
      continue;
    }

    const d = input.drops.find((x) => x.id === line.productId);
    if (d) {
      if (d.kind !== "DROP") throw new OrderError("AUCTION_LOT", "Auction lots settle through the bid ladder, not checkout.");
      if (!(d.priceUsd > 0)) throw new OrderError("NOT_PURCHASABLE", `${d.title} has no list price.`);
      if (new Date(d.endsAt).getTime() < Date.now()) throw new OrderError("DROP_CLOSED", `${d.title} has closed.`);
      if (d.remaining < line.quantity) {
        throw new OrderError("NO_STOCK", d.remaining > 0 ? `Only ${d.remaining} of ${d.title} remain in this drop.` : `${d.title} is sold out.`);
      }
      const unit = round2(d.priceUsd * mult);
      items.push({
        productId: d.id, sku: "RM-DRP-" + d.id.slice(-3).toUpperCase(), title: d.title, image: d.image, mint: d.mint,
        quantity: line.quantity, unitPriceUsd: unit, unitPremiumPct: round2(d.premiumPct),
        allocatedSerials: [], packedSerials: [], tebSeal: null,
      });
      if (!spotAtLock) spotAtLock = spot.prices[metalSymbol("gold")];
      continue;
    }

    throw new OrderError("UNKNOWN_PRODUCT", "That item is not in the catalog.", { productId: line.productId });
  }

  const totalUsd = round2(items.reduce((a, it) => a + it.unitPriceUsd * it.quantity, 0));
  if (!(totalUsd > 0)) throw new OrderError("ZERO_TOTAL", "Order total must be greater than zero.");

  // Drift check against what the customer saw.
  if (input.expectedTotalUsd !== undefined && input.expectedTotalUsd !== null) {
    const expected = Number(input.expectedTotalUsd);
    if (!Number.isFinite(expected)) throw new OrderError("BAD_TOTAL", "Expected total is not a number.");
    const tol = Math.max(TOLERANCE_ABS, totalUsd * TOLERANCE_FRAC);
    if (Math.abs(expected - totalUsd) > tol) {
      throw new OrderError(
        "PRICE_CHANGED",
        `The price moved while you were checking out. New total ${usd(totalUsd)} — refresh the quote to continue.`,
        { serverTotalUsd: totalUsd, expectedTotalUsd: expected },
      );
    }
  }

  const lockedUntil = claims
    ? new Date(claims.exp * 1000).toISOString()
    : new Date(Date.now() + LOCK_TTL_S * 1000).toISOString();

  return { items, totalUsd, spotAtLock: round2(spotAtLock), lockedUntil, payMethod, custody, address, shipTo, pricedAgainst };
}

const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
