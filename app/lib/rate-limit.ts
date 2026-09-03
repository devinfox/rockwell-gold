// Sliding-window rate limiter for the credential endpoint (audit: High —
// "no rate limiting or lockout on sign-in").
//
// Two layers, following OWASP Authentication Cheat Sheet guidance:
//   • per-source (IP) throttle so one client cannot hammer the endpoint;
//   • per-account failure lockout so a distributed attacker still cannot
//     brute-force a single email. Counters reset on a successful sign-in.
//
// State lives in process memory: correct for a single Node instance and the
// right first layer everywhere. On a multi-instance host add an edge/WAF rule
// or move the buckets to the shared store — the interface below is the seam.

export interface LimitResult {
  ok: boolean;
  /** Seconds until the caller may retry (0 when ok). */
  retryAfterSec: number;
  remaining: number;
}

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  // Keep the map bounded: drop any bucket whose newest hit is over an hour old.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    const newest = b.hits[b.hits.length - 1] ?? 0;
    if (now - newest > 3600_000) buckets.delete(k);
  }
}

/**
 * Records one hit against `key` and reports whether it is within `max` hits
 * per `windowMs`. Call `consume` for attempts you want to count (every sign-in
 * POST, every failed password) and `peek` to check without recording.
 */
export function consume(key: string, max: number, windowMs: number, now = Date.now()): LimitResult {
  sweep(now);
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= max) {
    const oldest = b.hits[0];
    buckets.set(key, b);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)), remaining: 0 };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true, retryAfterSec: 0, remaining: max - b.hits.length };
}

export function peek(key: string, max: number, windowMs: number, now = Date.now()): LimitResult {
  const b = buckets.get(key);
  const hits = (b?.hits ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)), remaining: 0 };
  }
  return { ok: true, retryAfterSec: 0, remaining: max - hits.length };
}

export function reset(key: string) {
  buckets.delete(key);
}

/** Test hook. */
export function _clearAll() {
  buckets.clear();
  lastSweep = 0;
}

// ————— policy for /api/auth —————

export const AUTH_LIMITS = {
  /** Any sign-in attempt from one source. */
  signInPerIp: { max: 30, windowMs: 15 * 60_000 },
  /** Failed passwords against one account, from anywhere. */
  failuresPerAccount: { max: 8, windowMs: 15 * 60_000 },
  /** Account creation from one source. */
  signUpPerIp: { max: 10, windowMs: 60 * 60_000 },
} as const;

/** Best-effort client address for keying. Trusts the first XFF hop like most proxies configure. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "local";
}
