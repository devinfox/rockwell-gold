// Catalog ⇄ Supabase row mapping, shared by the push/pull scripts and tests.
//
// Deliberately free of server-only / Next imports so it runs under tsx.
// The mapping is lossless in both directions: every typed Product field has
// a column, and anything the app has not typed yet travels in `extra`.

import type { Product } from "../data/catalog";
import type { LaunchRule, LaunchRuleBook } from "./pricing/launch-rules";

export const TABLES = {
  products: "rockwell_products",
  rules: "rockwell_pricing_rules",
  meta: "rockwell_catalog_meta",
  store: "rockwell_store",
} as const;

export const META_KEY_BOOK = "launch-pricing";

export interface ProductRow {
  id: string;
  position: number;
  sku: string;
  title: string;
  price: number | null;
  price_text: string;
  badge: string;
  mint: string;
  mint_slug: string;
  image: string;
  images: string[] | null;
  metal: string;
  year: number | null;
  short_summary: string | null;
  full_description: string | null;
  metal_content: string | null;
  purity: string | null;
  grade_finish: string | null;
  diameter_mm: string | null;
  thickness_mm: string | null;
  face_value: string | null;
  ira_eligible: string | null;
  obverse_description: string | null;
  reverse_description: string | null;
  tags: string[] | null;
  apmex_reference_url: string | null;
  jm_reference_url: string | null;
  launch_rank: number | null;
  extra: Record<string, unknown>;
}

export interface RuleRow {
  id: string;
  sku: string;
  pricing_type: string;
  live: boolean;
  needs_review: boolean;
  rule: LaunchRule;
}

/** Product field ↔ column. Order here is the column order in the table. */
const FIELD_TO_COLUMN: [keyof Product, keyof ProductRow][] = [
  ["id", "id"],
  ["sku", "sku"],
  ["title", "title"],
  ["price", "price"],
  ["priceText", "price_text"],
  ["badge", "badge"],
  ["mint", "mint"],
  ["mintSlug", "mint_slug"],
  ["image", "image"],
  ["images", "images"],
  ["metal", "metal"],
  ["year", "year"],
  ["shortSummary", "short_summary"],
  ["fullDescription", "full_description"],
  ["metalContent", "metal_content"],
  ["purity", "purity"],
  ["gradeFinish", "grade_finish"],
  ["diameterMm", "diameter_mm"],
  ["thicknessMm", "thickness_mm"],
  ["faceValue", "face_value"],
  ["iraEligible", "ira_eligible"],
  ["obverseDescription", "obverse_description"],
  ["reverseDescription", "reverse_description"],
  ["tags", "tags"],
  ["apmexReferenceUrl", "apmex_reference_url"],
  ["jmReferenceUrl", "jm_reference_url"],
  ["launchRank", "launch_rank"],
];

const KNOWN_FIELDS = new Set<string>(FIELD_TO_COLUMN.map(([f]) => f));
/** Columns that are NOT NULL text in the table; an absent field becomes "". */
const REQUIRED_TEXT = new Set<keyof ProductRow>(["price_text", "badge", "mint", "mint_slug", "image"]);

export function productToRow(p: Product, position: number): ProductRow {
  const row: Record<string, unknown> = { position, extra: {} };
  const extra: Record<string, unknown> = {};
  for (const [field, col] of FIELD_TO_COLUMN) {
    const v = (p as Record<string, unknown>)[field];
    if (v === undefined) {
      row[col] = REQUIRED_TEXT.has(col) ? "" : null;
    } else {
      row[col] = v;
    }
  }
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (!KNOWN_FIELDS.has(k)) extra[k] = v;
  }
  row.extra = extra;
  return row as unknown as ProductRow;
}

export function rowToProduct(r: ProductRow): Product {
  const p: Record<string, unknown> = {};
  for (const [field, col] of FIELD_TO_COLUMN) {
    const v = (r as unknown as Record<string, unknown>)[col];
    // Optional fields are omitted when null so the JSON matches the original
    // catalog shape byte-for-byte; required ones keep their null/"" value.
    if (v === null || v === undefined) {
      if (field === "price" || field === "year") p[field] = null;
      continue;
    }
    // numeric(12,2) comes back from PostgREST as a string
    if (field === "price") p[field] = typeof v === "string" ? Number(v) : v;
    else p[field] = v;
  }
  for (const [k, v] of Object.entries(r.extra ?? {})) p[k] = v;
  return p as unknown as Product;
}

export function ruleToRow(rule: LaunchRule): RuleRow {
  return { id: rule.id, sku: rule.sku, pricing_type: rule.pricingType, live: rule.live, needs_review: rule.needsReview, rule };
}

export function rowToRule(r: RuleRow): LaunchRule {
  return r.rule;
}

export type BookHeader = Omit<LaunchRuleBook, "rules"> & { repairs?: unknown[] };

export function bookHeader(book: LaunchRuleBook & { repairs?: unknown[] }): BookHeader {
  const { rules: _rules, ...header } = book;
  return header;
}

export function assembleBook(header: BookHeader, rules: LaunchRule[]): LaunchRuleBook & { repairs?: unknown[] } {
  const out: Record<string, LaunchRule> = {};
  for (const r of rules) out[r.id] = r;
  return { ...header, rules: out };
}
