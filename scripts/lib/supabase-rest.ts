// Minimal PostgREST client for the catalog scripts: service-role key, batched
// upserts, paged reads. No dependencies; .env.local is parsed here so the
// scripts run with plain `npx tsx`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(root: string) {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

export class Rest {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!url || !key) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.example).");
    }
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
    this.headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  private async req(path: string, init: RequestInit & { prefer?: string } = {}) {
    const headers: Record<string, string> = { ...this.headers, ...((init.headers as Record<string, string>) ?? {}) };
    if (init.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${this.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || text.includes("does not exist")) {
        throw new Error(`${path.split("?")[0]} is missing — apply supabase/migrations/20260903_rockwell_catalog.sql first. (${res.status}: ${text.slice(0, 200)})`);
      }
      throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }

  /** Upsert rows on the primary key in batches. */
  async upsert(table: string, rows: unknown[], batch = 200, onProgress?: (done: number) => void) {
    for (let i = 0; i < rows.length; i += batch) {
      await this.req(`/${table}`, {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: JSON.stringify(rows.slice(i, i + batch)),
      });
      onProgress?.(Math.min(rows.length, i + batch));
    }
  }

  /** Read a whole table, ordered, in pages. */
  async all<T>(table: string, order: string, select = "*", page = 500): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += page) {
      const res = await this.req(`/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}&offset=${offset}&limit=${page}`);
      const rows = (await res.json()) as T[];
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  }

  async count(table: string): Promise<number> {
    const res = await this.req(`/${table}?select=id`, { headers: { Range: "0-0" }, prefer: "count=exact" });
    const range = res.headers.get("content-range") ?? "";
    return Number(range.split("/")[1] ?? 0);
  }

  /** Delete rows whose id is not in the given set (so a removed product does not linger). */
  async deleteNotIn(table: string, ids: string[]) {
    // PostgREST "not.in" with a long list is fine for a 1k catalog.
    const list = ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    const res = await this.req(`/${table}?id=not.in.(${list})`, { method: "DELETE", prefer: "return=representation" });
    return ((await res.json()) as unknown[]).length;
  }
}
