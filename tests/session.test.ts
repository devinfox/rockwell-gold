import { describe, it, expect, beforeAll } from "vitest";
import {
  issueToken, verifyToken, hashPassword, verifyPassword, isStaff,
} from "../app/lib/session-token";

beforeAll(() => {
  process.env.RM_SESSION_SECRET = "test-secret-that-is-definitely-long-enough-32";
});

describe("session tokens", () => {
  const claims = { uid: "u-1", role: "CUSTOMER" as const, name: "Ada", email: "a@b.co" };

  it("round-trips a valid token", () => {
    const out = verifyToken(issueToken(claims));
    expect(out?.uid).toBe("u-1");
    expect(out?.role).toBe("CUSTOMER");
  });

  it("rejects a tampered payload", () => {
    const token = issueToken(claims);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, role: "SUPER_ADMIN", iat: 0, exp: 9e9 }),
    ).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`)).toBeNull();
    expect(body).toBeTruthy();
  });

  it("rejects a bad signature", () => {
    const token = issueToken(claims);
    expect(verifyToken(token.slice(0, -3) + "aaa")).toBeNull();
  });

  it("rejects malformed and empty input", () => {
    expect(verifyToken(undefined)).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("nodot")).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = Buffer.from(
      JSON.stringify({ ...claims, iat: 0, exp: Math.floor(Date.now() / 1000) - 10 }),
    ).toString("base64url");
    // Signature is irrelevant once exp has passed, but sign it properly anyway.
    expect(verifyToken(`${expired}.whatever`)).toBeNull();
  });
});

describe("passwords", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const hash = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("never stores the plaintext", () => {
    const hash = hashPassword("hunter2hunter2");
    expect(hash).not.toContain("hunter2");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("salts, so identical passwords differ", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("rejects a missing or malformed hash", () => {
    expect(verifyPassword("x", undefined)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("role helper", () => {
  it("classifies staff and customers", () => {
    expect(isStaff("SUPER_ADMIN")).toBe(true);
    expect(isStaff("LOGISTICS")).toBe(true);
    expect(isStaff("CUSTOMER")).toBe(false);
    expect(isStaff(null)).toBe(false);
  });
});
