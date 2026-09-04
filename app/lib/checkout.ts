"use client";

// Client-side price-lock session (blueprint §1.4 step 1).
// Locks live in localStorage keyed by RM-LCK id; the checkout route
// hydrates from here, and the 120s TTL is enforced by the page timer.

import type { Custody, PayMethod } from "./rm-types";

export interface CheckoutLock {
  id: string;
  productId: string;
  title: string;
  sku: string;
  image: string;
  mint: string;
  unitPrice: number;
  qty: number;
  spotAtLock: number;
  createdAt: number;
  expiresAt: number;
  /**
   * Server-signed token from /api/quote binding the spot marks this price was
   * built from. placeOrder re-prices against those marks; without a valid token
   * the server prices at the live mark. The unitPrice here is display only.
   */
  lockToken?: string;
  /**
   * Settlement rail and custody chosen on the product page. Optional: older
   * locks and the nav/palette "Instant Buy" path do not carry them. The
   * checkout page should initialise its `pay` / `custody` state from these
   * (falling back to WIRE / VAULT) so the choice made on the PDP is not
   * silently discarded (audit: Medium).
   */
  payMethod?: PayMethod;
  custody?: Custody;
}

const KEY = "rm-locks";
export const LOCK_TTL_MS = 120_000;

function readLocks(): Record<string, CheckoutLock> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeLocks(locks: Record<string, CheckoutLock>) {
  try {
    // prune anything long-dead so the store never grows
    const cutoff = Date.now() - 3600_000;
    for (const k of Object.keys(locks)) if (locks[k].createdAt < cutoff) delete locks[k];
    localStorage.setItem(KEY, JSON.stringify(locks));
  } catch {}
}

export function createLock(item: {
  productId: string; title: string; sku?: string; image?: string; mint?: string;
  unitPrice: number; qty?: number; spotAtLock?: number; lockToken?: string;
  payMethod?: PayMethod; custody?: Custody;
}): CheckoutLock {
  const lock: CheckoutLock = {
    id: "RM-LCK-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    productId: item.productId,
    title: item.title,
    sku: item.sku || "RM-AU-GEN",
    image: item.image || "/assets/coin-buffalo.png",
    mint: item.mint || "U.S. Mint",
    unitPrice: item.unitPrice,
    qty: item.qty || 1,
    // 0 means "not yet resolved" — the checkout page fills this from /api/spot.
    // It was previously the hardcoded literal 2387.4 (audit F-05).
    spotAtLock: item.spotAtLock ?? 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + LOCK_TTL_MS,
    lockToken: item.lockToken,
    payMethod: item.payMethod,
    custody: item.custody,
  };
  const locks = readLocks();
  locks[lock.id] = lock;
  writeLocks(locks);
  return lock;
}

export function getLock(id: string): CheckoutLock | null {
  return readLocks()[id] ?? null;
}

export function refreshLock(
  id: string,
  livePrice?: number,
  lockToken?: string | null,
  spotAtLock?: number,
): CheckoutLock | null {
  const locks = readLocks();
  const lock = locks[id];
  if (!lock) return null;
  if (livePrice) lock.unitPrice = livePrice;
  if (spotAtLock) lock.spotAtLock = spotAtLock;
  // A re-quote always replaces the token: an old one would re-price at the old mark.
  lock.lockToken = lockToken ?? undefined;
  lock.expiresAt = Date.now() + LOCK_TTL_MS;
  writeLocks(locks);
  return lock;
}

export function updateLock(id: string, patch: Partial<CheckoutLock>): CheckoutLock | null {
  const locks = readLocks();
  const lock = locks[id];
  if (!lock) return null;
  Object.assign(lock, patch);
  writeLocks(locks);
  return lock;
}

export function dropLock(id: string) {
  const locks = readLocks();
  delete locks[id];
  writeLocks(locks);
}
