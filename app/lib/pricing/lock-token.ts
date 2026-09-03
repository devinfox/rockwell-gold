// Signed price-lock tokens (audit: Critical — "the server accepts whatever
// price the browser sends; the 120-second lock lives only in localStorage").
//
// The storefront's 120 s price freeze is honoured server-side without any
// server state: /api/quote issues a token that binds the spot marks it priced
// against, signed with the session secret. At settlement the server re-runs
// the quote engine against the marks in the token (so quantity and rail can
// still change) and rejects anything the browser invented. An expired or
// missing token means "price at the live mark" — never "trust the client".

import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "../session-token";
import type { MetalSymbol, SpotQuote } from "../spot";

export const LOCK_TTL_S = 120;
/** Network + click latency allowance after the on-screen clock hits 00:00. */
export const LOCK_GRACE_S = 30;

export interface LockClaims {
  v: 1;
  prices: Record<MetalSymbol, number>;
  asOf: string;
  live: boolean;
  iat: number;
  exp: number;
}

const b64u = (s: string) => Buffer.from(s, "utf-8").toString("base64url");
const sign = (body: string) => createHmac("sha256", sessionSecret()).update(`lock.${body}`).digest("base64url");

export function issueLockToken(spot: Pick<SpotQuote, "prices" | "asOf" | "live">, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const claims: LockClaims = { v: 1, prices: spot.prices, asOf: spot.asOf, live: spot.live, iat, exp: iat + LOCK_TTL_S };
  const body = b64u(JSON.stringify(claims));
  return `${body}.${sign(body)}`;
}

/** Null for anything malformed, tampered, or past exp + grace. */
export function verifyLockToken(token: string | null | undefined, now = Date.now()): LockClaims | null {
  if (!token || typeof token !== "string" || token.length > 2048) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = Buffer.from(sign(body), "utf-8");
  const given = Buffer.from(mac, "utf-8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as LockClaims;
    if (c?.v !== 1 || typeof c.exp !== "number" || typeof c.iat !== "number") return null;
    if (!c.prices || typeof c.prices.XAU !== "number") return null;
    if (c.exp + LOCK_GRACE_S < Math.floor(now / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}

/** Rebuilds a SpotQuote from a verified token so the engine prices exactly what was shown. */
export function spotFromClaims(c: LockClaims, now = Date.now()): SpotQuote {
  const ageSeconds = Math.max(0, Math.round((now - Date.parse(c.asOf)) / 1000));
  return {
    prices: c.prices,
    change: { XAU: 0, XAG: 0, XPT: 0, XPD: 0 },
    asOf: c.asOf,
    source: "price-lock",
    live: c.live,
    ageSeconds,
    stale: !c.live,
    hardStale: false,
  };
}
