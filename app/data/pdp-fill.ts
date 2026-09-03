// Product-page helpers.
//
// This module used to generate fake social proof — a seeded star rating, a
// "verified buyers" count, a "sold this month" figure, invented scarcity and
// three testimonials drawn from a pool of six fictional handles — all rendered
// as genuine on every PDP (audit F-01). That generator has been removed. What
// remains derives only from real catalog fields.

import { availOf, products, type Product } from "./catalog";

const METAL_CODE: Record<string, string> = {
  gold: "AU",
  silver: "AG",
  platinum: "PT",
  palladium: "PD",
  copper: "CU",
  other: "XX",
};

/** Deterministic per-product values that are structural, not promotional. */
export function pdpFill(p: Product) {
  const avail = availOf(p);
  const serial = `RM-${METAL_CODE[p.metal] || "XX"}-${p.id}`;

  // Grade comes from the title when the source data states one.
  const gm = p.title.match(/\b(MS|PF|PR)-?(70|69)\b/i);
  const grade = gm ? `${gm[1].toUpperCase()}${gm[2]}` : p.gradeFinish || "Brilliant Uncirculated";

  return { avail, serial, grade };
}

/** Related picks: same mint first, then same metal. Deterministic by position. */
export function relatedTo(p: Product): Product[] {
  const sameMint = products.filter(
    (x) => x.id !== p.id && x.mintSlug === p.mintSlug && x.price != null,
  );
  const sameMetal = products.filter(
    (x) => x.id !== p.id && x.metal === p.metal && x.price != null,
  );

  const picks: Product[] = [];
  const seen = new Set<string>([p.id]);
  for (const source of [sameMint, sameMetal]) {
    for (const c of source) {
      if (picks.length >= 4) break;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      picks.push(c);
    }
    if (picks.length >= 4) break;
  }
  return picks.slice(0, 4);
}

export function metalLabel(metal: Product["metal"]) {
  return metal === "other" ? "Precious metal" : metal.charAt(0).toUpperCase() + metal.slice(1);
}

export function findProduct(id: string) {
  return products.find((p) => p.id === id);
}
