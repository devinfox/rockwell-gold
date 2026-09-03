// placeOrder end to end: server-side pricing, lock tokens, KYC tier limits,
// stock, and the automatic assay → allocation pipeline.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Order, Product } from "./helpers-types";

const SPOT = { prices: { XAU: 4500, XAG: 67, XPT: 1800, XPD: 1400 }, asOf: new Date().toISOString(), live: true };

let token: string;
let silver: Product;      // cheap, in stock, live-priced
let gold: Product;        // expensive, in stock, live-priced
let outOfStock: Product;  // AlertMe!® badge

const price = async (p: Product, qty: number) => {
  const { priceWithSpot } = await import("../app/lib/pricing/live");
  const { verifyLockToken, spotFromClaims } = await import("../app/lib/pricing/lock-token");
  const lp = priceWithSpot(p, spotFromClaims(verifyLockToken(token)!), qty)!;
  return lp;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

beforeAll(async () => {
  process.env.RM_SESSION_SECRET = "test-secret-that-is-definitely-long-enough-32";
  process.env.RM_DEMO_MODE = "true";
  process.env.RM_STORE_DRIVER = "file";
  const { _resetStoreForTests } = await import("../app/lib/rm-db");
  const { FileStore } = await import("../app/lib/rm-store");
  _resetStoreForTests(new FileStore(mkdtempSync(join(tmpdir(), "rm-orders-"))));

  const { issueLockToken, verifyLockToken, spotFromClaims } = await import("../app/lib/pricing/lock-token");
  token = issueLockToken(SPOT);
  const spot = spotFromClaims(verifyLockToken(token)!);

  const { products, availOf } = await import("../app/data/catalog");
  const { priceWithSpot } = await import("../app/lib/pricing/live");
  const live = (p: Product) => {
    const lp = priceWithSpot(p, spot, 1);
    return lp && lp.mode !== "enquire" ? lp : null;
  };
  silver = products.find((p) => p.metal === "silver" && availOf(p).key === "stock" && (() => { const lp = live(p); return !!lp && lp.cashPrice > 20 && lp.cashPrice < 300; })())!;
  gold = products.find((p) => p.metal === "gold" && availOf(p).key === "stock" && (() => { const lp = live(p); return !!lp && lp.cashPrice > 4000; })())!;
  outOfStock = products.find((p) => availOf(p).key === "notify" && !!live(p))!;
  expect(silver && gold && outOfStock).toBeTruthy();
});

const load = async () => await import("../app/lib/rm-db");
const jonas = { userId: "u-jonas", role: "CUSTOMER" as const };   // TIER_1 · UNVERIFIED
const adrian = { userId: "u-adrian", role: "CUSTOMER" as const }; // TIER_2 · CLEARED

describe("placeOrder pricing", () => {
  it("prices from the catalog against the locked marks and settles a vault order end to end", async () => {
    const { runAction, getDb } = await load();
    const lp = await price(silver, 2);
    const expected = round2(lp.cashPrice * 2);

    const res = await runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 2 }],
      totalUsd: expected, payMethod: "CRYPTO", custody: "VAULT", lockToken: token,
    }, jonas);
    const o = res.result as Order;

    expect(o.userId).toBe("u-jonas");
    expect(o.totalUsd).toBe(expected);
    expect(o.items[0].unitPriceUsd).toBe(lp.cashPrice);
    expect(o.spotAtLock).toBe(67);
    // Paid instantly on a crypto rail → assay → allocation, all server-side.
    expect(o.status).toBe("ALLOCATED");
    expect(o.items[0].allocatedSerials).toHaveLength(2);
    expect(o.history.map((h) => h.status)).toEqual(["LOCK_INITIATED", "PENDING_PAYMENT", "PAID", "IN_ASSAY", "ALLOCATED"]);
    expect(o.history.at(-1)?.by).toBe("system");

    const minted = getDb().holdings.filter((h) => h.orderId === o.id);
    expect(minted).toHaveLength(2);
    expect(minted.every((h) => h.userId === "u-jonas" && h.status === "VAULTED")).toBe(true);
    expect(getDb().audit.some((a) => a.action === "VAULT_PASSPORT_MINTED" && a.resourceId === o.id)).toBe(true);
  });

  it("refuses a tampered total", async () => {
    const { runAction } = await load();
    await expect(runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 100 }],
      totalUsd: 0.01, payMethod: "CRYPTO", custody: "VAULT", lockToken: token,
    }, jonas)).rejects.toMatchObject({ code: "PRICE_CHANGED" });
  });

  it("ignores any client-supplied unit price", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    const res = await runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 1, unitPriceUsd: 0.0001, sku: "FAKE", title: "Fake" }],
      totalUsd: lp.cashPrice, payMethod: "CRYPTO", custody: "VAULT", lockToken: token,
    }, jonas);
    const o = res.result as Order;
    expect(o.items[0].unitPriceUsd).toBe(lp.cashPrice);
    expect(o.items[0].sku).toBe(silver.sku);
    expect(o.items[0].title).toBe(silver.title);
  });

  it("refuses unknown, out-of-stock, and malformed lines", async () => {
    const { runAction } = await load();
    const base = { payMethod: "CRYPTO", custody: "VAULT", lockToken: token };
    await expect(runAction("placeOrder", { ...base, items: [{ productId: "nope", quantity: 1 }], totalUsd: 1 }, jonas))
      .rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });
    await expect(runAction("placeOrder", { ...base, items: [{ productId: outOfStock.id, quantity: 1 }], totalUsd: 1 }, jonas))
      .rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    await expect(runAction("placeOrder", { ...base, items: "notarray", totalUsd: 1 }, jonas))
      .rejects.toMatchObject({ code: "EMPTY" });
    await expect(runAction("placeOrder", { ...base, items: [{ productId: silver.id, quantity: 0 }], totalUsd: 1 }, jonas))
      .rejects.toMatchObject({ code: "BAD_QTY" });
    await expect(runAction("placeOrder", { ...base, items: [{ productId: silver.id, quantity: 1.5 }], totalUsd: 1 }, jonas))
      .rejects.toMatchObject({ code: "BAD_QTY" });
    await expect(runAction("placeOrder", { items: [{ productId: silver.id, quantity: 1 }], totalUsd: 1, payMethod: "MAGIC", custody: "VAULT" }, jonas))
      .rejects.toMatchObject({ code: "BAD_RAIL" });
  });

  it("applies the card multiplier server-side", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    const cardUnit = round2(lp.cashPrice / 0.96);
    const res = await runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 1 }],
      totalUsd: cardUnit, payMethod: "CARD", custody: "VAULT", lockToken: token,
    }, adrian);
    expect((res.result as Order).items[0].unitPriceUsd).toBe(cardUnit);
  });

  it("holds a wire order at PENDING_PAYMENT with no serials", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    const res = await runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 1 }],
      totalUsd: lp.cashPrice, payMethod: "WIRE", custody: "VAULT", lockToken: token,
    }, adrian);
    const o = res.result as Order;
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(o.items[0].allocatedSerials).toHaveLength(0);
  });

  it("routes a paid delivery order to the fulfilment queue with serials bound", async () => {
    const { runAction, getDb } = await load();
    const lp = await price(silver, 1);
    const res = await runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 1 }],
      totalUsd: lp.cashPrice, payMethod: "CRYPTO", custody: "DELIVERY",
      address: "2847 Sutter St, San Francisco, CA 94115", lockToken: token,
    }, adrian);
    const o = res.result as Order;
    expect(o.status).toBe("FULFILLMENT_QUEUE");
    expect(o.items[0].allocatedSerials).toHaveLength(1);
    expect(getDb().holdings.some((h) => h.orderId === o.id)).toBe(false);
  });

  it("requires a real delivery address", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    await expect(runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 1 }],
      totalUsd: lp.cashPrice, payMethod: "CRYPTO", custody: "DELIVERY", address: "my house", lockToken: token,
    }, adrian)).rejects.toMatchObject({ code: "BAD_ADDRESS" });
  });

  it("prices a live drop from the store", async () => {
    const { runAction, getDb } = await load();
    const drop = getDb().drops.find((d) => d.kind === "DROP" && d.remaining > 0)!;
    await runAction("claimDrop", { dropId: drop.id }, adrian);
    const res = await runAction("placeOrder", {
      items: [{ productId: drop.id, quantity: 1 }],
      totalUsd: drop.priceUsd, payMethod: "CRYPTO", custody: "VAULT", lockToken: token,
    }, adrian);
    const o = res.result as Order;
    expect(o.items[0].unitPriceUsd).toBe(drop.priceUsd);
    expect(o.status).toBe("ALLOCATED");
  });
});

describe("placeOrder KYC tier limits", () => {
  it("keeps an unverified account to crypto + vault under $10,000", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    const base = { items: [{ productId: silver.id, quantity: 1 }], lockToken: token };

    await expect(runAction("placeOrder", { ...base, totalUsd: round2(lp.cashPrice / 0.96), payMethod: "CARD", custody: "VAULT" }, jonas))
      .rejects.toMatchObject({ code: "KYC_LIMIT" });
    await expect(runAction("placeOrder", { ...base, totalUsd: lp.cashPrice, payMethod: "WIRE", custody: "VAULT" }, jonas))
      .rejects.toMatchObject({ code: "KYC_LIMIT" });
    await expect(runAction("placeOrder", { ...base, totalUsd: lp.cashPrice, payMethod: "CRYPTO", custody: "DELIVERY", address: "1 Market St, San Francisco, CA 94105" }, jonas))
      .rejects.toMatchObject({ code: "KYC_LIMIT" });

    const big = await price(gold, 3);
    await expect(runAction("placeOrder", { items: [{ productId: gold.id, quantity: 3 }], totalUsd: round2(big.cashPrice * 3), payMethod: "CRYPTO", custody: "VAULT", lockToken: token }, jonas))
      .rejects.toMatchObject({ code: "KYC_LIMIT" });
  });

  it("does not count an unreviewed tier: IN_REVIEW still trades at Tier 1", async () => {
    const { runAction, getDb } = await load();
    const compliance = getDb().users.find((u) => u.role === "COMPLIANCE")!;
    await runAction("kycSet", { userId: "u-jonas", kycTier: "TIER_2", kycStatus: "IN_REVIEW" }, { userId: compliance.id, role: "COMPLIANCE" });
    const lp = await price(silver, 1);
    await expect(runAction("placeOrder", { items: [{ productId: silver.id, quantity: 1 }], totalUsd: round2(lp.cashPrice / 0.96), payMethod: "CARD", custody: "VAULT", lockToken: token }, jonas))
      .rejects.toMatchObject({ code: "KYC_LIMIT" });

    await runAction("kycSet", { userId: "u-jonas", kycTier: "TIER_2", kycStatus: "CLEARED" }, { userId: compliance.id, role: "COMPLIANCE" });
    const ok = await runAction("placeOrder", { items: [{ productId: silver.id, quantity: 1 }], totalUsd: round2(lp.cashPrice / 0.96), payMethod: "CARD", custody: "VAULT", lockToken: token }, jonas);
    expect((ok.result as Order).status).toBe("ALLOCATED");
  });
});

describe("placeOrder stock", () => {
  it("refuses more units than a tracked lot can allocate", async () => {
    const { runAction, getDb } = await load();
    const db = getDb();
    const drop = db.drops.find((d) => d.kind === "DROP" && d.remaining > 0)!;
    // Track the drop in a lot with 1 free unit.
    db.inventory.push({
      id: "RM-LOT-TEST", productId: drop.id, sku: "RM-DRP-TST", title: drop.title, metal: "gold", mint: drop.mint,
      bay: "Bay T-01", unitWeightOz: 1, purityPct: 99.99, assayMethod: "XRF", ultrasonicPass: true,
      totalUnits: 1, allocatedUnits: 0, reorderAt: 0, intakeAt: new Date().toISOString(),
    });
    await expect(runAction("placeOrder", {
      items: [{ productId: drop.id, quantity: 2 }], totalUsd: drop.priceUsd * 2, payMethod: "CRYPTO", custody: "VAULT", lockToken: token,
    }, adrian)).rejects.toMatchObject({ code: "NO_STOCK" });
  });
});

describe("placeOrder delivery address", () => {
  it("accepts a structured address and renders it on the order", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    const res = await runAction("placeOrder", {
      items: [{ productId: silver.id, quantity: 1 }], totalUsd: lp.cashPrice, payMethod: "CRYPTO", custody: "DELIVERY", lockToken: token,
      shipTo: { recipient: "Adrian Reyes", street: "2847 Sutter St", unit: "Apt 4", city: "San Francisco", state: "ca", postalCode: "94115", country: "US", phone: "(415) 555-7741" },
    }, adrian);
    const o = res.result as Order & { shipTo?: { state: string; unit?: string } };
    expect(o.shipTo?.state).toBe("CA");
    expect(o.shipTo?.unit).toBe("Apt 4");
    expect(o.address).toContain("2847 Sutter St, Apt 4, San Francisco, CA 94115");
  });

  it("rejects P.O. boxes, bad ZIPs and unreachable phones with the offending field", async () => {
    const { runAction } = await load();
    const lp = await price(silver, 1);
    const base = { items: [{ productId: silver.id, quantity: 1 }], totalUsd: lp.cashPrice, payMethod: "CRYPTO", custody: "DELIVERY", lockToken: token };
    const good = { recipient: "Adrian Reyes", street: "2847 Sutter St", city: "San Francisco", state: "CA", postalCode: "94115", country: "US", phone: "4155557741" };
    await expect(runAction("placeOrder", { ...base, shipTo: { ...good, street: "PO Box 12" } }, adrian)).rejects.toMatchObject({ code: "BAD_ADDRESS", detail: { field: "street" } });
    await expect(runAction("placeOrder", { ...base, shipTo: { ...good, postalCode: "9411" } }, adrian)).rejects.toMatchObject({ code: "BAD_ADDRESS", detail: { field: "postalCode" } });
    await expect(runAction("placeOrder", { ...base, shipTo: { ...good, state: "California" } }, adrian)).rejects.toMatchObject({ code: "BAD_ADDRESS", detail: { field: "state" } });
    await expect(runAction("placeOrder", { ...base, shipTo: { ...good, phone: "555" } }, adrian)).rejects.toMatchObject({ code: "BAD_ADDRESS", detail: { field: "phone" } });
  });
});

describe("drops", () => {
  it("consumes drop units at settlement, not at claim", async () => {
    const { runAction, getDb } = await load();
    const drop = getDb().drops.find((d) => d.kind === "DROP" && d.remaining > 1 && d.id !== "drop-buffalo-batch")!;
    const before = drop.remaining;
    await runAction("claimDrop", { dropId: drop.id }, adrian);
    expect(getDb().drops.find((d) => d.id === drop.id)!.remaining).toBe(before);
    await runAction("placeOrder", { items: [{ productId: drop.id, quantity: 2 }], totalUsd: drop.priceUsd * 2, payMethod: "CRYPTO", custody: "VAULT", lockToken: token }, adrian);
    expect(getDb().drops.find((d) => d.id === drop.id)!.remaining).toBe(before - 2);
    await expect(runAction("placeOrder", { items: [{ productId: drop.id, quantity: before }], totalUsd: drop.priceUsd * before, payMethod: "CRYPTO", custody: "VAULT", lockToken: token }, adrian))
      .rejects.toMatchObject({ code: "NO_STOCK" });
  });
});
