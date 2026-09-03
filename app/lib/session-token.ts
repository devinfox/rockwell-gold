// Session + credential primitives — pure Node crypto, no Next.js request APIs,
// so this module is safe to import from proxy.ts as well as from route handlers.
// The session is an HMAC-signed token in an httpOnly cookie: the browser can
// read nothing out of it and can forge nothing into it. Roles are carried here
// and nowhere else — never in localStorage (audit S-04).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role } from "./rm-types";

export const SESSION_COOKIE = "rm_session";
const MAX_AGE_S = 7 * 24 * 3600;

export interface SessionClaims {
  uid: string;
  role: Role;
  name: string;
  email: string;
  /** issued-at / expires-at, epoch seconds */
  iat: number;
  exp: number;
}

// ————— secret —————

let warned = false;
/** The HMAC key for sessions and price-lock tokens. Exported for lock-token.ts only. */
export function sessionSecret(): string {
  return secret();
}
function secret(): string {
  const s = process.env.RM_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RM_SESSION_SECRET must be set to a random string of at least 32 characters in production.",
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[session] RM_SESSION_SECRET is unset — using an insecure development key. " +
        "Set it in .env.local before deploying.",
    );
  }
  return "rm-development-only-insecure-session-key-do-not-ship";
}

// ————— token —————

const b64u = (b: Buffer) => b.toString("base64url");

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueToken(claims: Omit<SessionClaims, "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionClaims = { ...claims, iat: now, exp: now + MAX_AGE_S };
  const body = b64u(Buffer.from(JSON.stringify(full), "utf-8"));
  return `${body}.${sign(body)}`;
}

/** Constant-time verification. Returns null for anything malformed, tampered or expired. */
export function verifyToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = Buffer.from(sign(body), "utf-8");
  const given = Buffer.from(mac, "utf-8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as SessionClaims;
    if (!claims?.uid || !claims?.role) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// ————— passwords (scrypt, no dependencies) —————

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyPassword(plain: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, key] = parts;
  try {
    const expected = Buffer.from(key, "base64url");
    const actual = scryptSync(plain.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "OPS_VAULT", "LOGISTICS", "COMPLIANCE", "SUPPORT"];
export const isStaff = (role: Role | undefined | null) => !!role && STAFF_ROLES.includes(role);
