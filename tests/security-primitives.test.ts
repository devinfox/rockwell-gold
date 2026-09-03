import { describe, it, expect, beforeAll } from "vitest";
import { safeNext, withNext } from "../app/lib/safe-next";
import { consume, peek, reset, _clearAll, clientIp, AUTH_LIMITS } from "../app/lib/rate-limit";
import { TIER_RULES, effectiveTier, tierViolation } from "../app/lib/kyc-limits";

beforeAll(() => {
  process.env.RM_SESSION_SECRET = "test-secret-that-is-definitely-long-enough-32";
});

describe("safeNext (open-redirect guard)", () => {
  it("accepts same-origin paths", () => {
    expect(safeNext("/vault", "/x")).toBe("/vault");
    expect(safeNext("/checkout/RM-LCK-1?a=1&b=2#top", "/x")).toBe("/checkout/RM-LCK-1?a=1&b=2#top");
    expect(safeNext("/gold/us-mint/american-eagles", "/x")).toBe("/gold/us-mint/american-eagles");
  });

  it("rejects everything that leaves the origin", () => {
    for (const bad of [
      "https://evil.example", "http://evil.example/", "//evil.example", "/\\evil.example",
      "/ /evil.example", "javascript:alert(1)", "/javascript:alert(1)", "/%2fevil.example", "/%5Cevil.example",
      "vault", "", "  ", null, undefined, "/vault\nSet-Cookie: x=y", "/http://evil.example",
    ]) {
      expect(safeNext(bad as string, "/fallback")).toBe("/fallback");
    }
  });

  it("builds auth links only with a safe next", () => {
    expect(withNext("/auth/sign-up", "/checkout/1")).toBe("/auth/sign-up?next=%2Fcheckout%2F1");
    expect(withNext("/auth/sign-up", "https://evil.example")).toBe("/auth/sign-up");
    expect(withNext("/auth/sign-up", null)).toBe("/auth/sign-up");
  });
});

describe("rate limiter", () => {
  it("allows up to max hits in a window, then refuses with a retry hint", () => {
    _clearAll();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(consume("k", 5, 60_000, t0 + i).ok).toBe(true);
    const blocked = consume("k", 5, 60_000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    // Window slides: once the oldest hit ages out, a slot frees up.
    expect(consume("k", 5, 60_000, t0 + 60_001).ok).toBe(true);
  });

  it("peek does not record, reset clears", () => {
    _clearAll();
    consume("acct", 2, 60_000, 1);
    consume("acct", 2, 60_000, 2);
    expect(peek("acct", 2, 60_000, 3).ok).toBe(false);
    expect(peek("acct", 2, 60_000, 3).ok).toBe(false);
    reset("acct");
    expect(peek("acct", 2, 60_000, 4).ok).toBe(true);
  });

  it("keys on the first forwarded hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("local");
  });

  it("has sane auth policy numbers", () => {
    expect(AUTH_LIMITS.failuresPerAccount.max).toBeLessThanOrEqual(10);
    expect(AUTH_LIMITS.signInPerIp.max).toBeGreaterThan(AUTH_LIMITS.failuresPerAccount.max);
  });
});

describe("KYC tier limits", () => {
  it("only a CLEARED tier counts", () => {
    expect(effectiveTier({ kycTier: "TIER_2", kycStatus: "UNVERIFIED" })).toBe("TIER_1");
    expect(effectiveTier({ kycTier: "TIER_2", kycStatus: "IN_REVIEW" })).toBe("TIER_1");
    expect(effectiveTier({ kycTier: "TIER_2", kycStatus: "CLEARED" })).toBe("TIER_2");
    expect(effectiveTier({ kycTier: "TIER_3", kycStatus: "CLEARED" })).toBe("TIER_3");
  });

  it("enforces rails, custody and the order ceiling per tier", () => {
    const t1 = { kycTier: "TIER_1" as const, kycStatus: "UNVERIFIED" as const };
    expect(tierViolation(t1, { totalUsd: 9_999, payMethod: "CRYPTO", custody: "VAULT" })).toBeNull();
    expect(tierViolation(t1, { totalUsd: 10_001, payMethod: "CRYPTO", custody: "VAULT" })).toMatch(/limit/i);
    expect(tierViolation(t1, { totalUsd: 100, payMethod: "CARD", custody: "VAULT" })).toMatch(/verification/i);
    expect(tierViolation(t1, { totalUsd: 100, payMethod: "CRYPTO", custody: "DELIVERY" })).toMatch(/delivery/i);

    const t2 = { kycTier: "TIER_2" as const, kycStatus: "CLEARED" as const };
    expect(tierViolation(t2, { totalUsd: 99_000, payMethod: "CARD", custody: "DELIVERY" })).toBeNull();
    expect(tierViolation(t2, { totalUsd: 100_001, payMethod: "WIRE", custody: "VAULT" })).toMatch(/limit/i);

    const t3 = { kycTier: "TIER_3" as const, kycStatus: "CLEARED" as const };
    expect(tierViolation(t3, { totalUsd: 5_000_000, payMethod: "WIRE", custody: "DELIVERY" })).toBeNull();
    expect(TIER_RULES.TIER_3.maxOrderUsd).toBe(Number.POSITIVE_INFINITY);

    expect(tierViolation({ kycTier: "TIER_3", kycStatus: "FLAGGED" }, { totalUsd: 1, payMethod: "CRYPTO", custody: "VAULT" })).toMatch(/paused/i);
  });
});

describe("price-lock tokens", () => {
  const spot = { prices: { XAU: 4500, XAG: 67, XPT: 1800, XPD: 1400 }, asOf: "2026-09-03T12:00:00.000Z", live: true };

  it("round-trips the marks and expires after TTL + grace", async () => {
    const { issueLockToken, verifyLockToken, spotFromClaims, LOCK_TTL_S, LOCK_GRACE_S } = await import("../app/lib/pricing/lock-token");
    const t0 = Date.parse("2026-09-03T12:00:05.000Z");
    const tok = issueLockToken(spot, t0);
    const c = verifyLockToken(tok, t0 + 1000)!;
    expect(c.prices.XAU).toBe(4500);
    expect(spotFromClaims(c, t0).prices.XAG).toBe(67);
    expect(spotFromClaims(c, t0).source).toBe("price-lock");
    expect(verifyLockToken(tok, t0 + (LOCK_TTL_S + LOCK_GRACE_S - 1) * 1000)).not.toBeNull();
    expect(verifyLockToken(tok, t0 + (LOCK_TTL_S + LOCK_GRACE_S + 2) * 1000)).toBeNull();
  });

  it("rejects tampering", async () => {
    const { issueLockToken, verifyLockToken } = await import("../app/lib/pricing/lock-token");
    const tok = issueLockToken(spot);
    const [body, mac] = tok.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), prices: { XAU: 1, XAG: 1, XPT: 1, XPD: 1 } })).toString("base64url");
    expect(verifyLockToken(`${forgedBody}.${mac}`)).toBeNull();
    expect(verifyLockToken(tok.slice(0, -2) + "zz")).toBeNull();
    expect(verifyLockToken("")).toBeNull();
    expect(verifyLockToken("nodot")).toBeNull();
  });
});
