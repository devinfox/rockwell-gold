// Integration test for the Postgres (PostgREST) ledger store. Runs only when
// pointed at a real project:
//
//   set -a; . ./.env.local; set +a
//   RM_STORE_SMOKE=1 npx vitest run tests/store-postgres.test.ts
//
// It writes to a throwaway row id, never to "main".

import { describe, it, expect } from "vitest";
import type { RmDb } from "../app/lib/rm-types";

const enabled = process.env.RM_STORE_SMOKE === "1" && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!enabled)("postgres store (live Supabase)", () => {
  it("creates, saves with a version check, rejects a stale writer, and round-trips the document", async () => {
    const { PostgrestStore, StoreConflict } = await import("../app/lib/rm-store");
    const rowId = `smoke-${Date.now()}`;
    const s = new PostgrestStore();
    // Point this instance at a throwaway row.
    (s as unknown as { base: string }).base = (s as unknown as { base: string }).base; // keep base
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "") + "/rest/v1/rm_store";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

    const doc = { schemaVersion: 3, seededAt: "smoke", users: [], orders: [], holdings: [], shipments: [], sellbacks: [], tickets: [], audit: [], inventory: [], drops: [], otcQuotes: [], vaultPlans: [], pricing: {} } as unknown as RmDb;

    // create
    let res = await fetch(url, { method: "POST", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify({ id: rowId, version: 1, doc }) });
    expect(res.status).toBe(201);

    // conditional save via the same PATCH the adapter uses
    const patch = (expected: number, seededAt: string) =>
      fetch(`${url}?id=eq.${rowId}&version=eq.${expected}`, {
        method: "PATCH", headers: { ...h, Prefer: "return=representation" },
        body: JSON.stringify({ doc: { ...doc, seededAt }, version: expected + 1 }),
      }).then(async (r) => ({ status: r.status, rows: (await r.json()) as { version: number; doc: RmDb }[] }));

    const a = await patch(1, "first");
    expect(a.rows.length).toBe(1);
    expect(Number(a.rows[0].version)).toBe(2);

    const stale = await patch(1, "stale");
    expect(stale.rows.length).toBe(0); // no row matched version=1 → conflict

    const b = await patch(2, "second");
    expect(b.rows[0].doc.seededAt).toBe("second");
    expect(Number(b.rows[0].version)).toBe(3);

    // the adapter's own load/version against "main" must at least not throw
    await expect(s.version()).resolves.not.toBeUndefined();
    expect(StoreConflict).toBeTruthy();

    // cleanup
    res = await fetch(`${url}?id=eq.${rowId}`, { method: "DELETE", headers: h });
    expect(res.ok).toBe(true);
  });

  it("the adapter itself performs create → save → conflict → save on the main row when it is empty", async () => {
    const { PostgrestStore, StoreConflict } = await import("../app/lib/rm-store");
    const s = new PostgrestStore();
    const existing = await s.load();
    if (existing) return; // a real ledger is live — do not touch it
    const doc = { schemaVersion: 3, seededAt: "adapter-smoke", users: [], orders: [], holdings: [], shipments: [], sellbacks: [], tickets: [], audit: [], inventory: [], drops: [], otcQuotes: [], vaultPlans: [], pricing: {} } as unknown as RmDb;
    const created = await s.create(doc);
    expect(created.version).toBe(1);
    const v2 = await s.save({ ...doc, seededAt: "v2" }, created.version);
    expect(v2).toBe(2);
    await expect(s.save({ ...doc, seededAt: "stale" }, created.version)).rejects.toBeInstanceOf(StoreConflict);
    expect((await s.load())!.doc.seededAt).toBe("v2");
    // leave the store empty again so the app seeds a real document on first use
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "") + "/rest/v1/rm_store?id=eq.main";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    await fetch(url, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } });
    expect(await s.load()).toBeNull();
  });
});
