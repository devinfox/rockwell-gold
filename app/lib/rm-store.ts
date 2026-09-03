import "server-only";

// Persistence for the system-realm document (audit: Critical — "JSON-file
// database cannot run on a multi-instance or serverless host").
//
// The domain logic in rm-db.ts stays synchronous over one in-memory document.
// What changes is how that document is loaded and saved:
//
//   file      data/db.json. Version = the file's mtime. Fine for one local
//             process; a second writer is detected and rejected, not clobbered.
//   postgres  one row in public.rockwell_store (Supabase) through PostgREST with the
//             service-role key. Version = a bigint the UPDATE is conditioned
//             on, so N serverless instances share one ledger safely.
//
// Every write is "save doc where version = the one I read". A mismatch throws
// StoreConflict; rm-db.transact() reloads and re-runs the action.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RmDb } from "./rm-types";

export class StoreConflict extends Error {
  constructor(msg = "The ledger changed under this request.") {
    super(msg);
    this.name = "StoreConflict";
  }
}

export class StoreUnavailable extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "StoreUnavailable";
  }
}

export interface Snapshot {
  doc: RmDb;
  version: number;
}

export interface StoreAdapter {
  readonly name: "file" | "postgres";
  /** Null when the store has never been written. */
  load(): Promise<Snapshot | null>;
  /** Cheap version probe; null when empty. */
  version(): Promise<number | null>;
  /** Insert the first document. If another writer got there first, returns theirs. */
  create(doc: RmDb): Promise<Snapshot>;
  /** Conditional write. Returns the new version or throws StoreConflict. */
  save(doc: RmDb, expectedVersion: number): Promise<number>;
}

export type StoreDriver = StoreAdapter["name"];

export function storeDriver(): StoreDriver {
  const v = (process.env.RM_STORE_DRIVER || "file").trim().toLowerCase();
  if (v === "postgres" || v === "supabase") return "postgres";
  if (v !== "file") console.warn(`[rm-store] unknown RM_STORE_DRIVER "${v}" — using file`);
  return "file";
}

// ————— file —————

export class FileStore implements StoreAdapter {
  readonly name = "file" as const;
  readonly dir: string;
  readonly path: string;

  constructor(dir = join(process.cwd(), "data")) {
    this.dir = dir;
    this.path = join(dir, "db.json");
  }

  private mtime(): number | null {
    try {
      return Math.round(statSync(this.path).mtimeMs);
    } catch {
      return null;
    }
  }

  loadSync(): Snapshot | null {
    if (!existsSync(this.path)) return null;
    const version = this.mtime() ?? 0;
    const doc = JSON.parse(readFileSync(this.path, "utf-8")) as RmDb;
    return { doc, version };
  }

  async load() {
    return this.loadSync();
  }

  async version() {
    return this.mtime();
  }

  /**
   * Atomic write via unique temp file + rename. The unique name means two
   * concurrent writers cannot rename a half-written file over the store.
   */
  saveSync(doc: RmDb, expectedVersion: number | null): number {
    const current = this.mtime();
    if (expectedVersion !== null && current !== null && current !== expectedVersion) {
      throw new StoreConflict();
    }
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(doc, null, 1), "utf-8");
      renameSync(tmp, this.path);
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* temp already gone */ }
      throw e;
    }
    return this.mtime() ?? Date.now();
  }

  async create(doc: RmDb) {
    const existing = this.loadSync();
    if (existing) return existing;
    return { doc, version: this.saveSync(doc, null) };
  }

  async save(doc: RmDb, expectedVersion: number) {
    return this.saveSync(doc, expectedVersion);
  }
}

// ————— postgres (PostgREST) —————

const ROW_ID = "main";

export class PostgrestStore implements StoreAdapter {
  readonly name = "postgres" as const;
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!url || !key) {
      throw new StoreUnavailable(
        "RM_STORE_DRIVER=postgres needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    this.base = `${url.replace(/\/$/, "")}/rest/v1/rockwell_store`;
    this.headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }

  private async req(path: string, init: RequestInit & { prefer?: string }): Promise<Response> {
    const headers: Record<string, string> = { ...this.headers };
    if (init.prefer) headers.Prefer = init.prefer;
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new StoreUnavailable(`rm_store unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 404 || (res.status === 400 && (await res.clone().text()).includes("rockwell_store"))) {
      throw new StoreUnavailable(
        "Table public.rockwell_store is missing. Apply supabase/migrations/20260903_rockwell_catalog.sql.",
      );
    }
    return res;
  }

  async load(): Promise<Snapshot | null> {
    const res = await this.req(`?id=eq.${ROW_ID}&select=version,doc`, { method: "GET" });
    if (!res.ok) throw new StoreUnavailable(`rm_store read failed (${res.status})`);
    const rows = (await res.json()) as { version: number; doc: RmDb }[];
    if (!rows.length) return null;
    return { doc: rows[0].doc, version: Number(rows[0].version) };
  }

  async version(): Promise<number | null> {
    const res = await this.req(`?id=eq.${ROW_ID}&select=version`, { method: "GET" });
    if (!res.ok) throw new StoreUnavailable(`rm_store read failed (${res.status})`);
    const rows = (await res.json()) as { version: number }[];
    return rows.length ? Number(rows[0].version) : null;
  }

  async create(doc: RmDb): Promise<Snapshot> {
    const res = await this.req("", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({ id: ROW_ID, version: 1, doc }),
    });
    if (res.status === 409) {
      // Another instance seeded first — theirs wins.
      const theirs = await this.load();
      if (theirs) return theirs;
    }
    if (!res.ok) throw new StoreUnavailable(`rm_store insert failed (${res.status}): ${await res.text()}`);
    const rows = (await res.json()) as { version: number; doc: RmDb }[];
    return { doc: rows[0].doc, version: Number(rows[0].version) };
  }

  async save(doc: RmDb, expectedVersion: number): Promise<number> {
    const next = expectedVersion + 1;
    const res = await this.req(`?id=eq.${ROW_ID}&version=eq.${expectedVersion}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({ doc, version: next, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new StoreUnavailable(`rm_store write failed (${res.status}): ${await res.text()}`);
    const rows = (await res.json()) as { version: number }[];
    if (!rows.length) throw new StoreConflict();
    return Number(rows[0].version);
  }
}

export function createStore(driver = storeDriver()): StoreAdapter {
  return driver === "postgres" ? new PostgrestStore() : new FileStore();
}
