import "server-only";

// Supplies Catalog Studio's working batch.
//
// The studio client imported the 12 MB unprocessed_jmbullion_remaining.json
// directly, which Turbopack emitted as a 9.4 MB client chunk. The dataset stays
// on the server now and the browser receives only the selected batch.

import type { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireStaff } from "../../lib/api-guard";

const SOURCE = path.join(process.cwd(), "app", "data", "unprocessed_jmbullion_remaining.json");

interface RawRow {
  rank?: number;
  sku?: string;
  title?: string;
  jm_title?: string;
  metal?: string;
  purity?: string;
  weight?: string;
  brand?: string;
  mint?: string;
  year?: string;
  price?: string;
  diameter?: string;
  thickness?: string;
  faceValue?: string;
  iraEligible?: string;
  imageUrl?: string;
  primaryImageUrl?: string;
}

let cache: RawRow[] | null = null;
function load(): RawRow[] {
  if (!cache) {
    cache = fs.existsSync(SOURCE) ? (JSON.parse(fs.readFileSync(SOURCE, "utf-8")) as RawRow[]) : [];
  }
  return cache;
}

function normalize(p: RawRow) {
  const rank = p.rank || 0;
  return {
    rank,
    sku: p.sku || `JM-${rank}`,
    title: p.title || p.jm_title || "Physical Bullion Product",
    metal: p.metal || "Gold",
    purity: p.purity || (p.metal === "Silver" ? ".999 Fine Silver" : ".9999 Fine Gold"),
    weight: p.weight || "1 oz",
    brand: p.brand || p.mint || "Sovereign / Private Mint",
    year: p.year || "Random Year / Varied Date",
    price: p.price || "Call for Price",
    diameter: p.diameter || "N/A",
    thickness: p.thickness || "N/A",
    faceValue: p.faceValue || "Legal Tender / Bullion",
    iraEligible: p.iraEligible || "Yes",
    primaryImageUrl: p.primaryImageUrl || p.imageUrl || "",
  };
}

/** Batch definitions live server-side so the client never needs the full set. */
const BATCHES: Record<string, (rows: RawRow[]) => RawRow[]> = {
  all_13596: (r) => r,
  first_1000: (r) => r.slice(0, 1000),
  next_500: (r) => r.slice(0, 500),
  sample_50: (r) => r.slice(0, 50),
  silver_8795: (r) => r.filter((p) => (p.metal ?? "").toLowerCase().includes("silver")),
  gold_3980: (r) => r.filter((p) => (p.metal ?? "").toLowerCase().includes("gold")),
};

export async function GET(request: NextRequest) {
  const gate = await requireStaff(["SUPER_ADMIN", "OPS_VAULT"]);
  if (!gate.ok) return gate.response;

  const key = request.nextUrl.searchParams.get("batch") ?? "sample_50";
  const pick = BATCHES[key];
  if (!pick) return Response.json({ error: "Unknown batch." }, { status: 400 });

  const rows = pick(load()).map(normalize);
  return Response.json(
    { batchKey: key, total: rows.length, rows },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
