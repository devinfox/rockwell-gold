// KYC tier limits — the single definition shared by the checkout UI, the
// KYC status page and the server-side order validator (audit: High — "tier
// limits are advertised but enforced nowhere").
//
// Client-safe: pure data and functions, no server imports.

import type { Custody, KycStatus, KycTier, PayMethod, User } from "./rm-types";

export interface TierRules {
  label: string;
  /** Maximum single-order settlement in USD. */
  maxOrderUsd: number;
  rails: readonly PayMethod[];
  custody: readonly Custody[];
}

export const TIER_RULES: Record<KycTier, TierRules> = {
  TIER_1: { label: "Tier 1 · Instant", maxOrderUsd: 10_000, rails: ["CRYPTO"], custody: ["VAULT"] },
  TIER_2: { label: "Tier 2 · Verified", maxOrderUsd: 100_000, rails: ["CRYPTO", "WIRE", "CARD"], custody: ["VAULT", "DELIVERY"] },
  TIER_3: { label: "Tier 3 · Institutional", maxOrderUsd: Number.POSITIVE_INFINITY, rails: ["CRYPTO", "WIRE", "CARD"], custody: ["VAULT", "DELIVERY"] },
};

/**
 * The tier a customer can actually trade at. A tier only counts once
 * compliance has cleared it; an account in review, unverified, or flagged
 * trades at Tier 1 (or not at all when flagged).
 */
export function effectiveTier(u: Pick<User, "kycTier" | "kycStatus">): KycTier {
  if (u.kycStatus === "CLEARED") return u.kycTier;
  return "TIER_1";
}

export function purchasesBlocked(status: KycStatus): boolean {
  return status === "FLAGGED";
}

export interface OrderShape {
  totalUsd: number;
  payMethod: PayMethod;
  custody: Custody;
}

/** Null when the order is within the customer's limits, otherwise a customer-facing reason. */
export function tierViolation(u: Pick<User, "kycTier" | "kycStatus">, o: OrderShape): string | null {
  if (purchasesBlocked(u.kycStatus)) {
    return "Purchases are paused on this account pending compliance review. Contact support.";
  }
  const tier = effectiveTier(u);
  const r = TIER_RULES[tier];
  if (!r.rails.includes(o.payMethod)) {
    return `${railLabel(o.payMethod)} settlement needs identity verification (Tier 2). Verify your identity or settle in crypto.`;
  }
  if (!r.custody.includes(o.custody)) {
    return "Insured delivery needs identity verification (Tier 2). Verify your identity or store in the allocated vault.";
  }
  if (o.totalUsd > r.maxOrderUsd) {
    return `This order exceeds your ${r.label.split(" · ")[0]} limit of ${usd0(r.maxOrderUsd)}. Verify your identity to raise it.`;
  }
  return null;
}

export const railLabel = (m: PayMethod) => (m === "CRYPTO" ? "Crypto" : m === "WIRE" ? "Bank wire" : "Card");

const usd0 = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
