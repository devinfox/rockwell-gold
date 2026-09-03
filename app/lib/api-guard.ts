import "server-only";

// Shared staff gate for the catalog-tooling routes. These write to disk and
// spawn subprocesses, so they must never be reachable anonymously (audit S-07, S-08).

import { NextResponse } from "next/server";
import { getDb, openDb } from "./rm-db";
import { readSession, isStaff } from "./session";
import type { Role } from "./rm-types";

export interface StaffContext {
  userId: string;
  role: Role;
}

/**
 * Returns the staff context, or a ready-to-return 401/403 response.
 * Errors are deliberately generic — no internal detail crosses the boundary.
 */
export async function requireStaff(
  allowed?: Role[],
): Promise<{ ok: true; staff: StaffContext } | { ok: false; response: NextResponse }> {
  const claims = await readSession();
  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }),
    };
  }

  try {
    await openDb({ maxAgeMs: 2000 });
  } catch (e) {
    console.error("[api-guard] ledger store unavailable —", e);
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Service temporarily unavailable." }, { status: 503 }),
    };
  }
  const user = getDb().users.find((u) => u.id === claims.uid);
  if (!user || user.frozen || !isStaff(user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Not permitted." }, { status: 403 }),
    };
  }
  if (allowed && !allowed.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Not permitted." }, { status: 403 }),
    };
  }

  return { ok: true, staff: { userId: user.id, role: user.role } };
}
