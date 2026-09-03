// Fine troy-ounce extraction from the catalog's free-text `metalContent`.
//
// Live pricing multiplies spot by the FINE metal content of an item, so this is
// the single most load-bearing derived field in the engine. The catalog has no
// numeric weight column — only strings like "1.0000 troy oz (31.1035 g)" — so
// every quote depends on parsing them correctly.
//
// Two things learned from auditing all 25,457 records:
//
//   1. The troy-oz figure is FINE content, not gross. A .9167 American Gold
//      Eagle reads "1.0000 troy oz (31.1035 g)": the 1.0000 oz is right (an
//      Eagle does contain one fine ounce) while the grams are merely
//      oz x 31.1035 — a real Eagle weighs 33.93 g gross. So we must never apply
//      a purity multiplier to the oz figure, and must not trust the grams.
//
//   2. The grams are therefore only safe to use when no oz figure is present.

export const GRAMS_PER_TROY_OZ = 31.1034768;
export const GRAMS_PER_KILO = 1000;

export type WeightSource =
  | "troy-oz"        // explicit troy-oz figure, treated as fine content
  | "troy-oz-pack"   // "2 x 1 troy oz" multi-packs
  | "fraction"       // "1/2 oz"
  | "kilo"
  | "grams"
  | "title";         // last resort, parsed from the product title

export interface FineWeight {
  fineOz: number;
  source: WeightSource;
  /** "high" only when the catalog stated troy ounces directly. */
  confidence: "high" | "medium" | "low";
}

const num = (s: string) => Number(s.replace(/,/g, ""));

/**
 * Extracts fine troy ounces. Returns null when the text carries no usable
 * weight ("N/A", empty) — callers must treat null as "not priceable", never
 * as zero.
 */
export function parseFineOz(metalContent?: string | null): FineWeight | null {
  const raw = (metalContent ?? "").trim();
  if (!raw || /^n\/?a$/i.test(raw)) return null;

  // "2 x 1 troy oz (62.2 g)" / "10 x 1 oz" — multi-packs. Must run before the
  // plain decimal rule, which would otherwise return just the pack count.
  const pack = raw.match(/(\d+)\s*[x×]\s*([\d.,]+)\s*(?:troy\s*)?oz/i);
  if (pack) {
    const count = num(pack[1]);
    const each = num(pack[2]);
    if (count > 0 && each > 0) {
      return { fineOz: count * each, source: "troy-oz-pack", confidence: "high" };
    }
  }

  // "10 x 1/10 oz" — fractional multi-packs (CombiBars).
  const packFrac = raw.match(/(\d+)\s*[x×]\s*(\d+)\s*\/\s*(\d+)\s*(?:troy\s*)?oz/i);
  if (packFrac) {
    const count = num(packFrac[1]);
    const den = num(packFrac[3]);
    if (count > 0 && den > 0) {
      return { fineOz: (count * num(packFrac[2])) / den, source: "troy-oz-pack", confidence: "high" };
    }
  }

  // "100 x 1 gram", "10x 10 g" — gram multi-packs (CombiBars).
  const packGrams = raw.match(/(\d+)\s*[x×]\s*([\d.,]+)\s*g(?:ram)?s?\b/i);
  if (packGrams) {
    const count = num(packGrams[1]);
    const each = num(packGrams[2]);
    if (count > 0 && each > 0) {
      return { fineOz: (count * each) / GRAMS_PER_TROY_OZ, source: "grams", confidence: "medium" };
    }
  }

  // "1/2 oz (15.55 g)", "1/10 troy oz"
  const frac = raw.match(/(\d+)\s*\/\s*(\d+)\s*(?:troy\s*)?oz/i);
  if (frac) {
    const den = num(frac[2]);
    if (den > 0) {
      return { fineOz: num(frac[1]) / den, source: "fraction", confidence: "high" };
    }
  }

  // "1.0000 troy oz", ".5000 troy oz", and the parenthetical form used when
  // grams lead: "100 grams (3.215 troy oz)".
  const troy = raw.match(/([\d.,]*\.?\d+)\s*troy\s*oz/i);
  if (troy) {
    const oz = num(troy[1]);
    if (oz > 0) return { fineOz: oz, source: "troy-oz", confidence: "high" };
  }

  // Bare "oz" with no "troy" qualifier.
  const oz = raw.match(/([\d.,]*\.?\d+)\s*oz/i);
  if (oz) {
    const v = num(oz[1]);
    if (v > 0) return { fineOz: v, source: "troy-oz", confidence: "high" };
  }

  // Weight given only in metric. Lower confidence: for an alloyed item this is
  // gross weight and would need purity applied, which we cannot verify here.
  const kilo = raw.match(/([\d.,]+)\s*kilo(?:gram)?/i);
  if (kilo) {
    const v = num(kilo[1]);
    if (v > 0) {
      return {
        fineOz: (v * GRAMS_PER_KILO) / GRAMS_PER_TROY_OZ,
        source: "kilo",
        confidence: "medium",
      };
    }
  }

  const grams = raw.match(/([\d.,]+)\s*g(?:ram)?s?\b/i);
  if (grams) {
    const v = num(grams[1]);
    if (v > 0) {
      return { fineOz: v / GRAMS_PER_TROY_OZ, source: "grams", confidence: "medium" };
    }
  }

  return null;
}

/**
 * Last-resort weight from the title ("1 oz Canadian Silver Maple Leaf").
 * Only for records whose metalContent is unusable; flagged low confidence so a
 * reviewer can find every product priced this way.
 */
/** Fine silver per $1 of face value for US coinage sold by face value. */
const SILVER_PER_FACE_DOLLAR: Record<string, number> = { "90": 0.715, "40": 0.295, "35": 0.05626, "80": 0.6 };

export function parseFineOzFromTitle(title?: string | null): FineWeight | null {
  const raw = (title ?? "").trim();
  if (!raw) return null;

  // "$100 Face Value Bag", "($10 FV, Circulated)" — junk silver by face value.
  // The purity comes from the title ("90% Silver"); 90% is the default because
  // pre-1965 dimes/quarters/halves/dollars are all .900 fine.
  const face = raw.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:face value|fv\b)/i);
  if (face) {
    const pct = raw.match(/\b(90|40|35|80)\s?%/)?.[1] ?? "90";
    const perDollar = SILVER_PER_FACE_DOLLAR[pct];
    const fv = num(face[1]);
    if (perDollar && fv > 0) return { fineOz: fv * perDollar, source: "title", confidence: "medium" };
  }

  // "100x 1 Gram", "50 x 1 Gram", "10 x 1/10 oz" — CombiBars named by their pack.
  const packG = raw.match(/(\d+)\s*[x×]\s*([\d.]+)\s*gram/i);
  if (packG) {
    const v = num(packG[1]) * num(packG[2]);
    if (v > 0) return { fineOz: v / GRAMS_PER_TROY_OZ, source: "title", confidence: "medium" };
  }
  const packF = raw.match(/(\d+)\s*[x×]\s*(\d+)\s*\/\s*(\d+)\s*oz\b/i);
  if (packF) {
    const den = num(packF[3]);
    if (den > 0) return { fineOz: (num(packF[1]) * num(packF[2])) / den, source: "title", confidence: "medium" };
  }

  const frac = raw.match(/(\d+)\s*\/\s*(\d+)\s*oz\b/i);
  if (frac) {
    const den = num(frac[2]);
    if (den > 0) return { fineOz: num(frac[1]) / den, source: "title", confidence: "low" };
  }

  const oz = raw.match(/([\d.]+)\s*oz\b/i);
  if (oz) {
    const v = num(oz[1]);
    if (v > 0) return { fineOz: v, source: "title", confidence: "low" };
  }

  return null;
}

/** metalContent first, then the title. Null when neither yields a weight. */
export function resolveFineOz(
  metalContent?: string | null,
  title?: string | null,
): FineWeight | null {
  return parseFineOz(metalContent) ?? parseFineOzFromTitle(title);
}
