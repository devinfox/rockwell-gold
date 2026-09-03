// The system realm's single API surface over the ledger store.
// GET  /api/rm  → state scoped to the caller (credentials stripped)
// POST /api/rm  → { action, ...payload } → runs an authorized domain transition
//
// Both are gated on the signed session cookie. proxy.ts also guards these paths,
// but per the Next.js data-security guidance authorization is re-checked here so
// a matcher change can never silently remove it.
//
// Every POST runs inside transact(): the document is loaded fresh, the action
// applied, and the result committed with an optimistic version check — so two
// instances (or two tabs) can never overwrite each other's orders.

import type { NextRequest } from "next/server";
import { getDb, openDb, projectDb, runAction, transact, AuthError, type Actor } from "../../lib/rm-db";
import { OrderError } from "../../lib/order-pricing";
import { StoreConflict, StoreUnavailable } from "../../lib/rm-store";
import { readSession } from "../../lib/session";

export const dynamic = "force-dynamic";

async function currentActor(): Promise<Actor> {
  const claims = await readSession();
  if (!claims) return null;
  // Re-read the role from the store rather than trusting the token alone, so a
  // revoked or demoted account loses access on its next request.
  const user = getDb().users.find((u) => u.id === claims.uid);
  if (!user) return null;
  return { userId: user.id, role: user.role };
}

export async function GET() {
  try {
    await openDb({ maxAgeMs: 1500 });
  } catch (e) {
    return storeFailure(e);
  }
  const actor = await currentActor();
  return Response.json(projectDb(actor), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const { action, ...payload } = body;
  if (!action || typeof action !== "string" || action.length > 64) {
    return Response.json({ ok: false, error: "Missing action." }, { status: 400 });
  }

  try {
    const { result } = await transact(async () => {
      const actor = await currentActor();
      return runAction(action, payload, actor);
    });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return actionFailure(e, action);
  }
}

// ————— error mapping —————
//
// Domain errors carry customer-facing text and are returned as-is. Runtime
// errors (a TypeError from an unexpected payload shape, say) are logged and
// replaced with a generic message so nothing internal crosses the boundary.

function actionFailure(e: unknown, action: string): Response {
  if (e instanceof AuthError) {
    return Response.json({ ok: false, error: e.message, code: "FORBIDDEN" }, { status: e.status });
  }
  if (e instanceof OrderError) {
    return Response.json({ ok: false, error: e.message, code: e.code, detail: e.detail ?? null }, { status: 400 });
  }
  if (e instanceof StoreConflict) {
    return Response.json(
      { ok: false, error: "The ledger is busy — please try again.", code: "CONFLICT" },
      { status: 409, headers: { "Retry-After": "1" } },
    );
  }
  if (e instanceof StoreUnavailable) return storeFailure(e);
  if (e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError) {
    console.error(`[api/rm] ${action}: invalid payload —`, e);
    return Response.json({ ok: false, error: "Invalid request.", code: "INVALID" }, { status: 400 });
  }
  if (e instanceof Error) {
    return Response.json({ ok: false, error: e.message, code: "REJECTED" }, { status: 400 });
  }
  console.error(`[api/rm] ${action}: unexpected failure —`, e);
  return Response.json({ ok: false, error: "Action failed.", code: "FAILED" }, { status: 400 });
}

function storeFailure(e: unknown): Response {
  console.error("[api/rm] ledger store unavailable —", e);
  return Response.json(
    { ok: false, error: "The ledger is temporarily unavailable. Please try again shortly.", code: "STORE_UNAVAILABLE" },
    { status: 503, headers: { "Retry-After": "5", "Cache-Control": "private, no-store" } },
  );
}
