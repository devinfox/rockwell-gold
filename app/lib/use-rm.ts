"use client";

// Client bridge to the local store: state fetching, action running,
// session management (localStorage["rm-session"]), shared formatters.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicRmDb, Role } from "./rm-types";
import { useInitialSession } from "./initial-session";

export interface RmSession {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

/**
 * The session lives in an httpOnly signed cookie and is resolved server-side.
 * The client can read it only as it comes back on the payload — it can no
 * longer mint or edit one (audit S-04).
 */
export function notifySessionChanged() {
  try {
    window.dispatchEvent(new Event("rm-session"));
  } catch {}
}

export async function signIn(email: string, password: string): Promise<RmSession> {
  return authCall({ intent: "sign-in", email, password });
}

export async function signUp(input: {
  fullName: string; email: string; phone?: string; password: string;
}): Promise<RmSession> {
  return authCall({ intent: "sign-up", ...input });
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "sign-out" }),
  });
  notifySessionChanged();
}

async function authCall(body: Record<string, unknown>): Promise<RmSession> {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "Authentication failed");
  notifySessionChanged();
  const u = json.user;
  return { userId: u.id, name: u.fullName, email: u.email, role: u.role };
}

/** A refused action. `code` lets the UI react (e.g. PRICE_CHANGED → re-quote). */
export class RmActionError extends Error {
  constructor(message: string, readonly code: string = "FAILED", readonly detail: Record<string, unknown> | null = null, readonly status = 400) {
    super(message);
    this.name = "RmActionError";
  }
}

export async function rmAction<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/rm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  let json: { ok?: boolean; result?: T; error?: string; code?: string; detail?: Record<string, unknown> | null };
  try {
    json = await res.json();
  } catch {
    throw new RmActionError("The server returned an unreadable response.", "BAD_RESPONSE", null, res.status);
  }
  if (!json.ok) throw new RmActionError(json.error || "Action failed", json.code || "FAILED", json.detail ?? null, res.status);
  return json.result as T;
}

export async function rmFetch(): Promise<PublicRmDb> {
  const res = await fetch("/api/rm", { cache: "no-store" });
  return (await res.json()) as PublicRmDb;
}

/** Live view of the store + the current session. Polls softly so the
 *  customer and admin realms stay in sync across tabs. */
export function useRm(pollMs = 6000) {
  const [db, setDb] = useState<PublicRmDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // Seeded by the root layout from the cookie, so the first paint already knows
  // who is signed in. Once the store has answered, the store wins — including
  // a null after sign-out, which `db?.session ?? initial` would wrongly mask.
  const initialSession = useInitialSession();

  const refresh = useCallback(async () => {
    try {
      const next = await rmFetch();
      if (alive.current) {
        setDb(next);
        setError(null);
      }
    } catch {
      if (alive.current) setError("Store unreachable");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    // The store is an external source; the first read has to happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    // Re-read after a sign-in/out, and when the tab returns to the foreground.
    const onSession = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("rm-session", onSession);
    document.addEventListener("visibilitychange", onVisible);
    // Only poll while the tab is actually being looked at.
    const t = pollMs > 0
      ? setInterval(() => {
          if (document.visibilityState === "visible") refresh();
        }, pollMs)
      : undefined;
    return () => {
      alive.current = false;
      window.removeEventListener("rm-session", onSession);
      document.removeEventListener("visibilitychange", onVisible);
      if (t) clearInterval(t);
    };
  }, [refresh, pollMs]);

  const act = useCallback(
    async <T = unknown>(action: string, payload: Record<string, unknown> = {}) => {
      // No actorId: the server derives the actor from the signed session.
      const result = await rmAction<T>(action, payload);
      await refresh();
      return result;
    },
    [refresh],
  );

  const session: RmSession | null = db ? db.session : initialSession;
  const user = db && session ? db.users.find((u) => u.id === session.userId) ?? null : null;

  return { db, session, user, act, refresh, error };
}

// ————— shared client formatters —————

export const usd = (v: number, dp = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const usd0 = (v: number) => usd(v, 0);

export function ago(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 0) return timeUntil(isoStr);
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeUntil(isoStr: string): string {
  const ms = new Date(isoStr).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function fmtDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Client-side CSV download (tax center exports, statements). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
