"use client";

// Client bridge to the local store: state fetching, action running,
// session management (localStorage["rm-session"]), shared formatters.

import { useCallback, useEffect, useState } from "react";
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

// ————— shared store poller —————
//
// One fetch loop per page, however many components call useRm(). The admin
// desk mounted eight hooks at 4–6 s each — on the order of a hundred /api/rm
// invocations a minute from a single open tab. Now every subscriber shares
// one in-flight request, one timer at the slowest interval anyone asked for
// (never faster than MIN_POLL_MS), and an ETag so an unchanged ledger costs
// the server a version probe and an empty 304 rather than a full projection.

const MIN_POLL_MS = 10_000;
const DEFAULT_POLL_MS = 30_000;
/** A visibility/mount refresh is skipped when a read landed this recently. */
const FRESH_MS = 3_000;

type Listener = (db: PublicRmDb | null, error: string | null) => void;

let shared: PublicRmDb | null = null;
let sharedError: string | null = null;
let etag: string | null = null;
let lastReadAt = 0;
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let timerMs = 0;
let globalHooked = false;
/** listener → requested poll interval (0 = this subscriber does not poll). */
const listeners = new Map<Listener, number>();

export async function rmFetch(): Promise<PublicRmDb> {
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch("/api/rm", { cache: "no-store", headers });
  if (res.status === 304 && shared) return shared;
  if (!res.ok) throw new Error(`store ${res.status}`);
  etag = res.headers.get("ETag");
  return (await res.json()) as PublicRmDb;
}

function broadcast() {
  for (const l of listeners.keys()) l(shared, sharedError);
}

/** Re-read the store once for every subscriber on the page; concurrent calls share one request. */
export function refreshRm(): Promise<void> {
  if (!inflight) {
    inflight = rmFetch()
      .then((next) => {
        shared = next;
        sharedError = null;
        lastReadAt = Date.now();
      })
      .catch(() => {
        sharedError = "Store unreachable";
      })
      .finally(() => {
        inflight = null;
        broadcast();
      });
  }
  return inflight;
}

/** A read that is guaranteed to start after now — used after an action so the caller sees its own write. */
async function refreshRmAfterWrite(): Promise<void> {
  if (inflight) await inflight;
  return refreshRm();
}

function rearm() {
  const wanted = [...listeners.values()].filter((ms) => ms > 0);
  const ms = wanted.length ? Math.max(MIN_POLL_MS, Math.min(...wanted)) : 0;
  if (ms === timerMs) return;
  if (timer) clearInterval(timer);
  timer = undefined;
  timerMs = ms;
  if (ms > 0) {
    // Only poll while the tab is actually being looked at.
    timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshRm();
    }, ms);
  }
}

function hookGlobal() {
  if (globalHooked || typeof window === "undefined") return;
  globalHooked = true;
  // Re-read after a sign-in/out, and when the tab returns to the foreground.
  window.addEventListener("rm-session", () => {
    etag = null; // the projection is per actor; never answer a new actor from the old tag
    refreshRm();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && listeners.size && Date.now() - lastReadAt > FRESH_MS) refreshRm();
  });
}

function subscribe(l: Listener, pollMs: number): () => void {
  hookGlobal();
  listeners.set(l, pollMs);
  rearm();
  return () => {
    listeners.delete(l);
    rearm();
  };
}

/** Live view of the store + the current session, shared with every other
 *  useRm() on the page. `pollMs` is a request, floored at MIN_POLL_MS; 0 means
 *  this component is content to ride on whatever the others poll. */
export function useRm(pollMs = DEFAULT_POLL_MS) {
  const [db, setDb] = useState<PublicRmDb | null>(shared);
  const [error, setError] = useState<string | null>(sharedError);
  // Seed from the layout (always null now that public pages are cached; kept so
  // a future server seed drops straight back in). Once the store has answered,
  // the store wins — including a null after sign-out.
  const initialSession = useInitialSession();

  useEffect(() => {
    const listener: Listener = (next, err) => {
      setDb(next);
      setError(err);
    };
    const unsubscribe = subscribe(listener, pollMs);
    // The store is an external source; the first read has to happen after
    // mount. A read that just landed for another subscriber is reused as-is.
    if (shared && Date.now() - lastReadAt < FRESH_MS) {
      listener(shared, sharedError);
    } else {
      refreshRm();
    }
    return unsubscribe;
  }, [pollMs]);

  const refresh = useCallback(() => refreshRm(), []);

  const act = useCallback(
    async <T = unknown>(action: string, payload: Record<string, unknown> = {}) => {
      // No actorId: the server derives the actor from the signed session.
      const result = await rmAction<T>(action, payload);
      await refreshRmAfterWrite();
      return result;
    },
    [],
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
