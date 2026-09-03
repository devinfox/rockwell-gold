/* eslint-disable @typescript-eslint/no-explicit-any -- feed rows are untyped scrape output; sanitised field-by-field below */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireStaff } from "../../lib/api-guard";

const PRODUCTS_PATH = path.join(process.cwd(), "app", "data", "products.json");
const CHECKPOINT_PATH = path.join(process.cwd(), "data", "catalog_studio_checkpoint.json");
const UNPROCESSED_PATH = path.join(process.cwd(), "app", "data", "unprocessed_non_apmex_catalog.json");

interface SynthesizedProduct {
  rank: number;
  sku: string;
  productTitle: string;
  shortSummary: string;
  metal: string;
  metalContent: string;
  purity: string;
  mint: string;
  year: string;
  gradeFinish: string;
  diameterMm: string;
  thicknessMm: string;
  faceValue: string;
  iraEligible: string;
  obverseDescription: string;
  reverseDescription: string;
  fullDescription: string;
  tags: string[];
  primaryImageUrl: string;
}

// Mirrors make_mint_slug in scripts/sync_rockwell_catalog.py — keep in sync.
function makeMintSlug(mintName: string): string {
  const m = (mintName || "").toLowerCase();
  if (m.includes("united states") || m.includes("u.s.") || m.includes("us mint")) return "us-mint";
  if (m.includes("canadian") || m.includes("rcm")) return "royal-canadian-mint";
  if (m.includes("perth")) return "perth-mint";
  if (m.includes("royal mint")) return "royal-mint";
  if (m.includes("austrian")) return "austrian-mint";
  if (m.includes("pamp")) return "pamp-suisse";
  if (m.includes("valcambi")) return "valcambi";
  if (m.includes("credit suisse")) return "credit-suisse";
  if (m.includes("johnson matthey")) return "johnson-matthey";
  if (m.includes("engelhard")) return "engelhard";
  if (m.includes("silvertowne")) return "silvertowne";
  if (m.includes("sunshine")) return "sunshine-minting";
  if (m.includes("germania")) return "germania-mint";
  if (m.includes("scottsdale")) return "scottsdale-mint";
  if (m.includes("asahi")) return "asahi";
  if (m.includes("geiger")) return "geiger";
  if (m.includes("mexican") || m.includes("casa de moneda")) return "mexican-mint";
  if (m.includes("south african")) return "south-african-mint";
  if (m.includes("chinese") || m.includes("china gold")) return "chinese-mint";
  return "world-mints";
}

function parseYear(yearStr: string): number | null {
  const match = /\b(18\d\d|19\d\d|20\d\d)\b/.exec(String(yearStr || ""));
  return match ? parseInt(match[1], 10) : null;
}

function normalizeMetal(metalStr: string): string {
  const m = (metalStr || "").toLowerCase();
  if (m.includes("gold")) return "gold";
  if (m.includes("silver")) return "silver";
  if (m.includes("platinum")) return "platinum";
  if (m.includes("palladium")) return "palladium";
  return "other";
}

function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null;
  const num = parseFloat(String(priceStr).replace(/[$,]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toProduct(item: SynthesizedProduct, feedByRank: Map<number, any>) {
  const rank = Number(item.rank);
  const feed = feedByRank.get(rank) || {};
  const priceNum = parsePrice(feed.price);
  const priceText = priceNum !== null
    ? `$${priceNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "Call for price";

  return {
    id: String(rank),
    sku: item.sku || `RM-${rank}`,
    title: item.productTitle || "",
    price: priceNum,
    priceText,
    badge: rank % 7 === 0 ? "Sale" : "In Stock",
    mint: item.mint || "World & Private Mints",
    mintSlug: makeMintSlug(item.mint),
    image: item.primaryImageUrl || feed.imageUrl || "",
    metal: normalizeMetal(item.metal),
    year: parseYear(item.year),
    shortSummary: item.shortSummary || "",
    fullDescription: item.fullDescription || "",
    metalContent: item.metalContent || "",
    purity: item.purity || "",
    gradeFinish: item.gradeFinish || "",
    diameterMm: item.diameterMm || "",
    thicknessMm: item.thicknessMm || "",
    faceValue: item.faceValue || "",
    iraEligible: item.iraEligible || "No",
    obverseDescription: item.obverseDescription || "",
    reverseDescription: item.reverseDescription || "",
    tags: item.tags || [],
    apmexReferenceUrl: "",
  };
}

/** Caps a value to a string of at most `max` characters. */
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);

/**
 * Whitelists and bounds every field before it can reach the live catalog.
 * Anything not listed here is dropped rather than trusted (audit S-07).
 */
function sanitize(raw: unknown): SynthesizedProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Record<string, unknown>;
  const rank = Number(it.rank);
  if (!Number.isFinite(rank) || rank < 0 || rank > 10_000_000) return null;
  if (!str(it.productTitle, 300).trim()) return null;

  // Only http(s) image URLs — no data:, javascript: or protocol-relative URLs.
  let img = str(it.primaryImageUrl, 600).trim();
  if (img && !/^https?:\/\//i.test(img)) img = "";

  const tags = Array.isArray(it.tags)
    ? it.tags.slice(0, 25).map((t) => str(t, 60)).filter(Boolean)
    : [];

  return {
    rank,
    sku: str(it.sku, 80),
    productTitle: str(it.productTitle, 300),
    shortSummary: str(it.shortSummary, 1200),
    metal: str(it.metal, 40),
    metalContent: str(it.metalContent, 120),
    purity: str(it.purity, 40),
    mint: str(it.mint, 120),
    year: str(it.year, 40),
    gradeFinish: str(it.gradeFinish, 120),
    diameterMm: str(it.diameterMm, 40),
    thicknessMm: str(it.thicknessMm, 40),
    faceValue: str(it.faceValue, 60),
    iraEligible: str(it.iraEligible, 10) === "Yes" ? "Yes" : "No",
    obverseDescription: str(it.obverseDescription, 4000),
    reverseDescription: str(it.reverseDescription, 4000),
    fullDescription: str(it.fullDescription, 20000),
    tags,
    primaryImageUrl: img,
  };
}

export async function POST(req: NextRequest) {
  const gate = await requireStaff(["SUPER_ADMIN", "OPS_VAULT"]);
  if (!gate.ok) return gate.response;

  try {
    let items: SynthesizedProduct[] = [];
    try {
      const body = await req.json();
      if (Array.isArray(body.items)) items = body.items;
    } catch {
      // No/invalid body — fall back to the disk checkpoint below.
    }

    if (!items.length) {
      if (!fs.existsSync(CHECKPOINT_PATH)) {
        return NextResponse.json(
          { success: false, error: "No items provided and no checkpoint found on disk." },
          { status: 400 }
        );
      }
      const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8"));
      items = Object.values(cp.synthesizedItems || {});
    }

    items = items.map(sanitize).filter((it): it is SynthesizedProduct => it !== null);
    if (!items.length) {
      return NextResponse.json(
        { success: false, error: "No synthesized items available to deploy." },
        { status: 400 }
      );
    }

    let feedByRank = new Map<number, any>();
    if (fs.existsSync(UNPROCESSED_PATH)) {
      const feed = JSON.parse(fs.readFileSync(UNPROCESSED_PATH, "utf-8"));
      feedByRank = new Map(feed.map((p: any) => [Number(p.rank), p]));
    }

    const products: any[] = fs.existsSync(PRODUCTS_PATH)
      ? JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf-8"))
      : [];
    const existingIds = new Set(products.map((p) => String(p.id)));

    const fresh = items.filter((it) => !existingIds.has(String(it.rank)));
    const skipped = items.length - fresh.length;

    if (fresh.length) {
      const additions = fresh
        .sort((a, b) => Number(a.rank) - Number(b.rank))
        .map((it) => toProduct(it, feedByRank));
      const merged = [...products, ...additions];

      // Write atomically so a crash mid-write can't truncate the live catalog.
      const tmpPath = `${PRODUCTS_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
      fs.renameSync(tmpPath, PRODUCTS_PATH);
    }

    return NextResponse.json({
      success: true,
      deployed: fresh.length,
      skipped,
      totalLive: products.length + fresh.length,
    });
  } catch (error) {
    console.error("Deploy catalog error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
