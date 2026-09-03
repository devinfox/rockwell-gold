// Credential endpoint. This is the only place a session is minted.
// POST /api/auth { intent: "sign-in" | "sign-up" | "sign-out", ... }
//
// Sessions are httpOnly signed cookies — the browser never sees the role and
// cannot forge one (audit S-03, S-04). Attempts are throttled per source and
// failures are counted per account (audit: High — no rate limiting).

import type { NextRequest } from "next/server";
import { authenticate, registerUser, transact, DEMO_MODE } from "../../lib/rm-db";
import { StoreUnavailable } from "../../lib/rm-store";
import { writeSession, clearSession, readSession } from "../../lib/session";
import { AUTH_LIMITS, clientIp, consume, peek, reset } from "../../lib/rate-limit";
import type { User } from "../../lib/rm-types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

const publicUser = (u: User) => {
  const { passwordHash: _pw, ...rest } = u;
  return rest;
};

/** Uniform delay floor so a failed lookup can't be timed apart from a failed password. */
async function settle<T>(started: number, value: T): Promise<T> {
  const elapsed = Date.now() - started;
  if (elapsed < 250) await new Promise((r) => setTimeout(r, 250 - elapsed));
  return value;
}

function tooMany(retryAfterSec: number, what: string) {
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  return Response.json(
    { ok: false, error: `Too many ${what}. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec), ...NO_STORE } },
  );
}

function storeDown(e: unknown) {
  console.error("[api/auth] ledger store unavailable —", e);
  return Response.json(
    { ok: false, error: "Sign-in is temporarily unavailable. Please try again shortly.", code: "STORE_UNAVAILABLE" },
    { status: 503, headers: { "Retry-After": "5", ...NO_STORE } },
  );
}

export async function GET() {
  const claims = await readSession();
  return Response.json(
    {
      session: claims ? { userId: claims.uid, name: claims.name, email: claims.email, role: claims.role } : null,
      demoMode: DEMO_MODE,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400, headers: NO_STORE });
  }

  const intent = String(body.intent || "");
  const ip = clientIp(request.headers);

  if (intent === "sign-out") {
    await clearSession();
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  if (intent === "sign-up") {
    const gate = consume(`su:${ip}`, AUTH_LIMITS.signUpPerIp.max, AUTH_LIMITS.signUpPerIp.windowMs);
    if (!gate.ok) return tooMany(gate.retryAfterSec, "new accounts from this connection");

    let res;
    try {
      res = await transact(() =>
        registerUser({
          fullName: String(body.fullName || ""),
          email: String(body.email || ""),
          phone: body.phone ? String(body.phone) : undefined,
          password: String(body.password || ""),
        }),
      );
    } catch (e) {
      if (e instanceof StoreUnavailable) return storeDown(e);
      throw e;
    }
    if (!res.ok || !res.user) {
      return await settle(started, Response.json({ ok: false, error: res.error }, { status: 400, headers: NO_STORE }));
    }
    await writeSession({
      uid: res.user.id, role: res.user.role, name: res.user.fullName, email: res.user.email,
    });
    return await settle(started, Response.json({ ok: true, user: publicUser(res.user) }, { headers: NO_STORE }));
  }

  if (intent === "sign-in") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    const ipGate = consume(`si:${ip}`, AUTH_LIMITS.signInPerIp.max, AUTH_LIMITS.signInPerIp.windowMs);
    if (!ipGate.ok) return tooMany(ipGate.retryAfterSec, "sign-in attempts");

    const acctKey = `sf:${email}`;
    const acctGate = peek(acctKey, AUTH_LIMITS.failuresPerAccount.max, AUTH_LIMITS.failuresPerAccount.windowMs);
    if (!acctGate.ok) return await settle(started, tooMany(acctGate.retryAfterSec, "sign-in attempts for this account"));

    let res;
    try {
      res = await transact(() => authenticate(email, password));
    } catch (e) {
      if (e instanceof StoreUnavailable) return storeDown(e);
      throw e;
    }
    if (!res.ok || !res.user) {
      consume(acctKey, AUTH_LIMITS.failuresPerAccount.max, AUTH_LIMITS.failuresPerAccount.windowMs);
      return await settle(started, Response.json({ ok: false, error: res.error }, { status: 401, headers: NO_STORE }));
    }
    reset(acctKey);
    await writeSession({
      uid: res.user.id, role: res.user.role, name: res.user.fullName, email: res.user.email,
    });
    return await settle(started, Response.json({ ok: true, user: publicUser(res.user) }, { headers: NO_STORE }));
  }

  return Response.json({ ok: false, error: "Unknown intent." }, { status: 400, headers: NO_STORE });
}
