// Local JSON "database" for the Rockwell system realm.
// Persists to data/db.json on disk (stands in for Supabase/Postgres for now).
// All state-machine transitions live here so every mutation lands in the
// append-only audit ledger, exactly like the blueprint's Part 3 demands.

import "server-only";

import type {
  RmDb, PublicRmDb, PublicUser, User, Order, OrderItem, VaultHolding, Shipment, SellBackRequest,
  SupportTicket, AuditLog, InventoryLot, Drop, OtcQuote, PricingSettings,
  OrderStatus, Carrier, Role, TicketPriority,
} from "./rm-types";
import { CARRIER_LABEL, SPOT } from "./rm-types";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword, isStaff } from "./session-token";
import { createStore, StoreConflict, StoreUnavailable, FileStore, type StoreAdapter } from "./rm-store";
import { priceOrder, OrderError, PAY_METHODS, CUSTODIES } from "./order-pricing";
import { tierViolation } from "./kyc-limits";
import type { PayMethod, Custody } from "./rm-types";

/**
 * Bump when the seed shape changes. Version 1 stores are re-seeded (no
 * credentials); version 2 stores are migrated in place (seeded flag added).
 */
const SCHEMA_VERSION = 3;

/** Demo accounts are usable only when this is explicitly on. Never enable in production. */
export const DEMO_MODE = process.env.RM_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
const DEMO_PASSWORD = process.env.RM_DEMO_PASSWORD || "rockwell-demo-2026";

/**
 * Accounts that become SUPER_ADMIN automatically: on registration, or on the
 * next store open if they already exist as customers. This is the only way
 * to create the first operator outside demo mode; further staff are promoted
 * from the console via `setRole`.
 */
export function bootstrapAdminEmails(): string[] {
  return (process.env.RM_BOOTSTRAP_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Every user id the seed creates. Anything else is a real account. */
export const SEED_USER_IDS = [
  "u-adrian", "u-adrian-alias", "s-admin", "u-mei", "u-jonas", "u-priya",
  "s-victoria", "s-marcus", "s-elena", "s-sarah", "s-dev",
] as const;

// ————— id + time helpers —————

let idCounter = 0;
const nid = (prefix: string) => {
  idCounter = (idCounter + 1) % 1000;
  const n = Date.now().toString(36).slice(-5).toUpperCase() + idCounter.toString(36).toUpperCase();
  return `${prefix}-${n}`;
};
const ordinal = (n: number) => String(n).padStart(4, "0");
const iso = (msFromNow = 0) => new Date(Date.now() + msFromNow).toISOString();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const SERIAL_PREFIX: Record<string, string> = { gold: "AU", silver: "AG", platinum: "PT", palladium: "PD" };
export const mkSerial = (metal: string, sku: string) =>
  `RM-${SERIAL_PREFIX[metal] ?? "AU"}-${sku.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase() || "GEN"}-${Math.floor(1000 + Math.random() * 9000)}`;

const mkBay = () =>
  `Bay ${"ABCD"[Math.floor(Math.random() * 4)]}-${ordinal(Math.ceil(Math.random() * 12)).slice(2)} · Shelf ${Math.ceil(Math.random() * 4)} · Row ${Math.ceil(Math.random() * 18)}`;

// ————— seed —————

function seedUsers(now: string): User[] {
  // Seeded accounts share one scrypt digest of the demo password. They are only
  // reachable when RM_DEMO_MODE=true (see authenticate) — never in production.
  const demoHash = hashPassword(DEMO_PASSWORD);
  const base = {
    twoFactorEnabled: true, frozen: false, staffNotes: [] as string[], createdAt: now,
    passwordHash: demoHash, seeded: true as const,
  };
  return [
    {
      id: "u-adrian", email: "customer@rockwell.demo", phone: "+1 (415) 555-7741", fullName: "Adrian Reyes",
      role: "CUSTOMER", accountType: "INDIVIDUAL", kycTier: "TIER_2", kycStatus: "CLEARED",
      riskRating: "LOW", ...base, staffNotes: ["Sovereign-tier stacker since Mar 2025. Prefers wire settlement."],
    },
    {
      id: "u-adrian-alias", email: "adrian@rockwell.demo", phone: "+1 (415) 555-7741", fullName: "Adrian Reyes",
      role: "CUSTOMER", accountType: "INDIVIDUAL", kycTier: "TIER_2", kycStatus: "CLEARED",
      riskRating: "LOW", ...base, staffNotes: ["Sovereign-tier stacker since Mar 2025. Prefers wire settlement."],
    },
    {
      id: "s-admin", email: "admin@rockwell.demo", phone: "ext. 100", fullName: "Victoria Cross",
      role: "SUPER_ADMIN", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED", riskRating: "LOW", ...base,
    },
    {
      id: "u-mei", email: "mei.tan@demo.com", phone: "+65 8555 0141", fullName: "Mei Lin Tan",
      role: "CUSTOMER", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED",
      riskRating: "LOW", ...base, staffNotes: ["Sovereign-tier individual stacker. OTC desk relationship — quote via V. Cross."],
    },
    {
      id: "u-jonas", email: "jonas.b@stackmail.demo", phone: "+1 (720) 555-0983", fullName: "Jonas Bright",
      role: "CUSTOMER", accountType: "INDIVIDUAL", kycTier: "TIER_1", kycStatus: "UNVERIFIED",
      riskRating: "MEDIUM", ...base,
    },
    {
      id: "u-priya", email: "priya.n@gmail.demo", phone: "+1 (312) 555-2210", fullName: "Priya Natarajan",
      role: "CUSTOMER", accountType: "INDIVIDUAL", kycTier: "TIER_2", kycStatus: "IN_REVIEW",
      riskRating: "LOW", ...base,
    },
    {
      id: "s-victoria", email: "v.cross@rockwellmetals.demo", phone: "ext. 100", fullName: "Victoria Cross",
      role: "SUPER_ADMIN", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED", riskRating: "LOW", ...base,
    },
    {
      id: "s-marcus", email: "m.webb@rockwellmetals.demo", phone: "ext. 210", fullName: "Marcus Webb",
      role: "OPS_VAULT", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED", riskRating: "LOW", ...base,
    },
    {
      id: "s-elena", email: "e.diaz@rockwellmetals.demo", phone: "ext. 310", fullName: "Elena Diaz",
      role: "LOGISTICS", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED", riskRating: "LOW", ...base,
    },
    {
      id: "s-sarah", email: "s.okafor@rockwellmetals.demo", phone: "ext. 410", fullName: "Sarah Okafor",
      role: "COMPLIANCE", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED", riskRating: "LOW", ...base,
    },
    {
      id: "s-dev", email: "d.patel@rockwellmetals.demo", phone: "ext. 510", fullName: "Dev Patel",
      role: "SUPPORT", accountType: "INDIVIDUAL", kycTier: "TIER_3", kycStatus: "CLEARED", riskRating: "LOW", ...base,
    },
  ];
}

const COINS = {
  buffalo: { productId: "buffalo-1oz", sku: "RM-AU-BUF", title: "American Gold Buffalo · 1 oz", image: "/assets/coin-buffalo.png", mint: "U.S. Mint", metal: "gold", purity: 99.99, price: 2559 },
  eagle: { productId: "eagle-1oz", sku: "RM-AU-EGL", title: "American Gold Eagle · 1 oz", image: "/assets/coin-eagle.png", mint: "U.S. Mint", metal: "gold", purity: 91.67, price: 2552 },
  maple: { productId: "maple-1oz", sku: "RM-AU-MPL", title: "Canadian Gold Maple Leaf · 1 oz", image: "/assets/coin-maple.png", mint: "Royal Canadian Mint", metal: "gold", purity: 99.99, price: 2519 },
  angel: { productId: "angel-1oz", sku: "RM-AU-ANG", title: "St. Helena Lucky Angel PF70 · 1 oz", image: "/assets/coin-angel.png", mint: "East India Company", metal: "gold", purity: 99.99, price: 2722 },
  britannia: { productId: "britannia-1oz", sku: "RM-AU-BRT", title: "Gold Britannia · 1 oz", image: "/assets/coin-britannia.png", mint: "The Royal Mint", metal: "gold", purity: 99.99, price: 2531 },
  kangaroo: { productId: "kangaroo-1oz", sku: "RM-AU-KGR", title: "Perth Mint Kangaroo · 1 oz", image: "/assets/coin-kangaroo.png", mint: "The Perth Mint", metal: "gold", purity: 99.99, price: 2524 },
  proofEagle: { productId: "proof-eagle-1oz", sku: "RM-AU-PEG", title: "Proof American Gold Eagle · 1 oz", image: "/assets/coin-proof-eagle.png", mint: "U.S. Mint", metal: "gold", purity: 91.67, price: 2989 },
};

function holdingOf(c: (typeof COINS)[keyof typeof COINS], userId: string, serial: string, cost: number, ageDays: number, orderId: string | null = null): VaultHolding {
  return {
    id: nid("RM-HLD"), userId, orderId, productId: c.productId, title: c.title, image: c.image, mint: c.mint,
    serialNumber: serial, purityPct: c.purity, weightOz: 1, grade: c === COINS.angel ? "PF70 Ultra Cameo" : "BU · Sealed",
    costUsd: cost, vaultBay: mkBay(), status: "VAULTED",
    lastVerifiedAt: iso(-6 * DAY), createdAt: iso(-ageDays * DAY),
  };
}

function seed(): RmDb {
  const now = iso();
  const users = seedUsers(now);

  // Adrian's vault mirrors the /vault dashboard: 3 Buffalo, 2 Eagle, 5 Maple, 1 Angel.
  const holdings: VaultHolding[] = [
    holdingOf(COINS.buffalo, "u-adrian", "RM-AU-BUF-7741", 2440, 148),
    holdingOf(COINS.buffalo, "u-adrian", "RM-AU-BUF-7802", 2440, 121),
    holdingOf(COINS.buffalo, "u-adrian", "RM-AU-BUF-8119", 2440, 63),
    holdingOf(COINS.eagle, "u-adrian", "RM-AU-EGL-3306", 2500, 97),
    holdingOf(COINS.eagle, "u-adrian", "RM-AU-EGL-3411", 2500, 97),
    holdingOf(COINS.maple, "u-adrian", "RM-AU-MPL-5520", 2410, 82),
    holdingOf(COINS.maple, "u-adrian", "RM-AU-MPL-5521", 2410, 82),
    holdingOf(COINS.maple, "u-adrian", "RM-AU-MPL-5522", 2410, 82),
    holdingOf(COINS.maple, "u-adrian", "RM-AU-MPL-6102", 2410, 2),
    holdingOf(COINS.maple, "u-adrian", "RM-AU-MPL-6103", 2410, 2),
    holdingOf(COINS.angel, "u-adrian", "RM-AU-ANG-0007", 2600, 21),
    holdingOf(COINS.britannia, "u-mei", "RM-AU-BRT-1150", 2488, 40),
    holdingOf(COINS.britannia, "u-mei", "RM-AU-BRT-1151", 2488, 40),
    holdingOf(COINS.kangaroo, "u-mei", "RM-AU-KGR-2208", 2475, 40),
  ];

  const mkOrder = (
    n: number, userId: string, coin: (typeof COINS)[keyof typeof COINS], qty: number,
    status: OrderStatus, pay: Order["payMethod"], custody: Order["custody"], ageDays: number,
    serials: string[] = [], shipmentId: string | null = null,
  ): Order => {
    const unit = coin.price;
    const item: OrderItem = {
      productId: coin.productId, sku: coin.sku, title: coin.title, image: coin.image, mint: coin.mint,
      quantity: qty, unitPriceUsd: unit, unitPremiumPct: +(100 * (unit / SPOT.XAU - 1)).toFixed(2),
      allocatedSerials: serials, packedSerials: [], tebSeal: null,
    };
    const created = iso(-ageDays * DAY);
    const flow: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "IN_ASSAY", "ALLOCATED", "FULFILLMENT_QUEUE", "DISPATCHED", "DELIVERED"];
    const idx = flow.indexOf(status);
    const history = [{ status: "LOCK_INITIATED" as OrderStatus, at: created, by: userId }].concat(
      flow.slice(0, idx + 1).map((s, i) => ({ status: s, at: iso(-ageDays * DAY + (i + 1) * HOUR), by: i < 2 ? userId : "s-marcus" })),
    );
    return {
      id: `RM-ORD-${ordinal(1000 + n)}`, userId, status, items: [item],
      totalUsd: +(unit * qty).toFixed(2), spotAtLock: SPOT.XAU, lockedUntil: created,
      payMethod: pay, payRef: pay === "WIRE" ? "FW-2026-" + (81000 + n) : "ch_3PqK" + n + "vX",
      custody, address: custody === "DELIVERY" ? "2847 Sutter St, San Francisco, CA 94115" : null,
      shipmentId, history, createdAt: created,
    };
  };

  const shipments: Shipment[] = [
    {
      id: "RM-SHP-0207", orderId: "RM-ORD-1006", userId: "u-adrian", kind: "ORDER",
      carrier: "BRINKS", trackingNumber: "BRK-77021-4410", tamperSealBarcode: "TEB-88410-C",
      insurancePolicy: "LLD-250M-8841", status: "IN_TRANSIT",
      checkpoints: [
        { label: "Manifest scanned · departed vault", location: "Rockwell Vault Facility, DE", at: iso(-1.4 * DAY) },
        { label: "Armored line-haul", location: "Philadelphia hub, PA", at: iso(-1.1 * DAY) },
        { label: "Custody transfer verified", location: "Chicago secure depot, IL", at: iso(-0.4 * DAY) },
      ],
      eta: iso(1.2 * DAY), address: "2847 Sutter St, San Francisco, CA 94115",
      contents: "Proof American Gold Eagle · 1 oz ×1", signatureName: null, signatureAt: null, createdAt: iso(-1.5 * DAY),
    },
    {
      id: "RM-SHP-0201", orderId: "RM-ORD-1003", userId: "u-priya", kind: "ORDER",
      carrier: "FEDEX_PRIORITY", trackingNumber: "FDX-4482-9917-02", tamperSealBarcode: "TEB-88102-A",
      insurancePolicy: "LLD-250M-8802", status: "DELIVERED",
      checkpoints: [
        { label: "Manifest scanned · departed vault", location: "Rockwell Vault Facility, DE", at: iso(-9 * DAY) },
        { label: "Priority line-haul", location: "Memphis hub, TN", at: iso(-8.4 * DAY) },
        { label: "Out for delivery", location: "Chicago, IL", at: iso(-7.3 * DAY) },
        { label: "Delivered · direct signature + photo ID", location: "Chicago, IL", at: iso(-7.1 * DAY) },
      ],
      eta: iso(-7.1 * DAY), address: "118 W Kinzie St, Chicago, IL 60654",
      contents: "Gold Britannia · 1 oz ×2", signatureName: "P. Natarajan", signatureAt: iso(-7.1 * DAY), createdAt: iso(-9 * DAY),
    },
  ];

  const orders: Order[] = [
    mkOrder(1, "u-adrian", COINS.buffalo, 3, "DELIVERED", "WIRE", "VAULT", 148, ["RM-AU-BUF-7741", "RM-AU-BUF-7802", "RM-AU-BUF-8119"]),
    mkOrder(2, "u-adrian", COINS.eagle, 2, "ALLOCATED", "WIRE", "VAULT", 97, ["RM-AU-EGL-3306", "RM-AU-EGL-3411"]),
    mkOrder(3, "u-priya", COINS.britannia, 2, "DELIVERED", "CARD", "DELIVERY", 9, ["RM-AU-BRT-1201", "RM-AU-BRT-1202"], "RM-SHP-0201"),
    mkOrder(4, "u-adrian", COINS.maple, 2, "ALLOCATED", "CARD", "VAULT", 2, ["RM-AU-MPL-6102", "RM-AU-MPL-6103"]),
    mkOrder(5, "u-mei", COINS.kangaroo, 20, "IN_ASSAY", "WIRE", "VAULT", 1),
    mkOrder(6, "u-adrian", COINS.proofEagle, 1, "DISPATCHED", "CARD", "DELIVERY", 2, ["RM-AU-PEG-0114"], "RM-SHP-0207"),
    mkOrder(7, "u-jonas", COINS.maple, 1, "PENDING_PAYMENT", "WIRE", "VAULT", 0.2),
    mkOrder(8, "u-priya", COINS.buffalo, 5, "PAID", "CARD", "DELIVERY", 0.4),
    mkOrder(9, "u-mei", COINS.britannia, 40, "PAID", "WIRE", "VAULT", 0.6),
  ];
  // fix allocated order statuses that map to vault custody
  const o2 = orders.find((o) => o.id === "RM-ORD-1002")!;
  o2.status = "ALLOCATED";

  const sellbacks: SellBackRequest[] = [
    {
      id: "RM-SB-0088", userId: "u-adrian", serials: ["RM-AU-EGL-3299"], title: COINS.eagle.title, quantity: 1,
      lockedBidUsd: 2531, spreadPct: 0.5, payout: "WIRE", status: "DISBURSED",
      payoutRef: "FW-2026-80714", createdAt: iso(-7 * DAY),
    },
    {
      id: "RM-SB-0091", userId: "u-mei", serials: ["RM-AU-BRT-1150"], title: COINS.britannia.title, quantity: 1,
      lockedBidUsd: 2519, spreadPct: 0.5, payout: "WIRE", status: "REQUESTED",
      payoutRef: null, createdAt: iso(-0.15 * DAY),
    },
  ];

  const tickets: SupportTicket[] = [
    {
      id: "RM-TCK-0412", userId: "u-adrian", orderId: "RM-ORD-1006", kind: "GENERAL",
      subject: "Delivery window for RM-SHP-0207", priority: "MEDIUM", status: "IN_PROGRESS", assignee: "s-dev",
      messages: [
        { from: "u-adrian", fromName: "Adrian Reyes", staff: false, text: "Can I get a tighter delivery window for the proof Eagle in transit? I need to be home to sign.", at: iso(-0.9 * DAY) },
        { from: "s-dev", fromName: "Dev Patel", staff: true, text: "Checking with Brinks — current ETA is tomorrow 10:00–14:00. I'll confirm the 2-hour window as soon as the courier commits.", at: iso(-0.7 * DAY) },
      ],
      createdAt: iso(-0.9 * DAY),
    },
    {
      id: "RM-TCK-0415", userId: "u-priya", orderId: null, kind: "GENERAL",
      subject: "Re-verify assay on Britannia pair", priority: "LOW", status: "OPEN", assignee: null,
      messages: [
        { from: "u-priya", fromName: "Priya Natarajan", staff: false, text: "Requesting a fresh XRF re-verification record for my two delivered Britannias — need it for insurance.", at: iso(-0.3 * DAY) },
      ],
      createdAt: iso(-0.3 * DAY),
    },
  ];

  const inventory: InventoryLot[] = [
    { id: "RM-LOT-3301", productId: COINS.buffalo.productId, sku: COINS.buffalo.sku, title: COINS.buffalo.title, metal: "gold", mint: COINS.buffalo.mint, bay: "Bay A-02 · Shelf 1 · Rows 1–6", unitWeightOz: 1, purityPct: 99.99, assayMethod: "XRF + ultrasonic", ultrasonicPass: true, totalUnits: 184, allocatedUnits: 122, reorderAt: 40, intakeAt: iso(-31 * DAY) },
    { id: "RM-LOT-3308", productId: COINS.eagle.productId, sku: COINS.eagle.sku, title: COINS.eagle.title, metal: "gold", mint: COINS.eagle.mint, bay: "Bay A-04 · Shelf 2 · Rows 2–9", unitWeightOz: 1, purityPct: 91.67, assayMethod: "XRF + ultrasonic", ultrasonicPass: true, totalUnits: 240, allocatedUnits: 205, reorderAt: 50, intakeAt: iso(-24 * DAY) },
    { id: "RM-LOT-3312", productId: COINS.maple.productId, sku: COINS.maple.sku, title: COINS.maple.title, metal: "gold", mint: COINS.maple.mint, bay: "Bay B-01 · Shelf 1 · Rows 4–12", unitWeightOz: 1, purityPct: 99.99, assayMethod: "XRF + ultrasonic", ultrasonicPass: true, totalUnits: 320, allocatedUnits: 118, reorderAt: 60, intakeAt: iso(-17 * DAY) },
    { id: "RM-LOT-3319", productId: COINS.britannia.productId, sku: COINS.britannia.sku, title: COINS.britannia.title, metal: "gold", mint: COINS.britannia.mint, bay: "Bay B-06 · Shelf 3 · Rows 1–8", unitWeightOz: 1, purityPct: 99.99, assayMethod: "XRF + ultrasonic", ultrasonicPass: true, totalUnits: 150, allocatedUnits: 141, reorderAt: 35, intakeAt: iso(-12 * DAY) },
    { id: "RM-LOT-3324", productId: COINS.kangaroo.productId, sku: COINS.kangaroo.sku, title: COINS.kangaroo.title, metal: "gold", mint: COINS.kangaroo.mint, bay: "Bay C-03 · Shelf 2 · Rows 3–10", unitWeightOz: 1, purityPct: 99.99, assayMethod: "XRF + ultrasonic", ultrasonicPass: true, totalUnits: 96, allocatedUnits: 44, reorderAt: 25, intakeAt: iso(-6 * DAY) },
    { id: "RM-LOT-3330", productId: COINS.proofEagle.productId, sku: COINS.proofEagle.sku, title: COINS.proofEagle.title, metal: "gold", mint: COINS.proofEagle.mint, bay: "Bay D-01 · Shelf 1 · Rows 1–2", unitWeightOz: 1, purityPct: 91.67, assayMethod: "XRF + ultrasonic + die-mark", ultrasonicPass: true, totalUnits: 22, allocatedUnits: 19, reorderAt: 8, intakeAt: iso(-4 * DAY) },
  ];

  const drops: Drop[] = [
    {
      id: "drop-angel-x", kind: "AUCTION", auctionStyle: "ENGLISH", title: "Lucky Angel PF70 · First Strike",
      image: "/assets/coin-angel.png", mint: "East India Company", meta: "1 oz · PF70 UCAM · pop 250",
      priceUsd: 2905, startBidUsd: 2700, bidIncrementUsd: 25, premiumPct: 21.7, supply: 1, remaining: 1,
      endsAt: iso(2.4 * HOUR),
      bids: [
        { bidder: "M. T••", amountUsd: 2905, at: iso(-0.2 * HOUR) },
        { bidder: "R. K••", amountUsd: 2880, at: iso(-0.6 * HOUR) },
        { bidder: "A. R••", amountUsd: 2855, at: iso(-1.1 * HOUR) },
      ],
      extendedCount: 0,
    },
    {
      id: "drop-proof-eagle", kind: "AUCTION", auctionStyle: "ENGLISH", title: "1995-W Proof Eagle · PR70",
      image: "/assets/coin-proof-eagle.png", mint: "U.S. Mint", meta: "1 oz · key date · pop 412",
      priceUsd: 21400, startBidUsd: 18000, bidIncrementUsd: 200, premiumPct: 796.5, supply: 1, remaining: 1,
      endsAt: iso(26 * HOUR),
      bids: [
        { bidder: "T. W••", amountUsd: 21400, at: iso(-3 * HOUR) },
        { bidder: "M. T••", amountUsd: 21200, at: iso(-5 * HOUR) },
      ],
      extendedCount: 0,
    },
    {
      id: "drop-buffalo-batch", kind: "DROP", title: "2026 Buffalo · Vault Batch 44",
      image: "/assets/coin-buffalo.png", mint: "U.S. Mint", meta: "1 oz · 99.99 fine · sealed",
      priceUsd: 2559, premiumPct: 7.2, supply: 120, remaining: 9, endsAt: iso(3.1 * HOUR), bids: [], extendedCount: 0,
    },
    {
      id: "drop-maple-fresh", kind: "DROP", title: "Maple Leaf · Fresh Mint Sheet",
      image: "/assets/coin-maple.png", mint: "Royal Canadian Mint", meta: "1 oz · 99.99 fine · new batch",
      priceUsd: 2519, premiumPct: 5.5, supply: 200, remaining: 64, endsAt: iso(9 * HOUR), bids: [], extendedCount: 0,
    },
    {
      id: "drop-britannia-allocation", kind: "DROP", title: "Britannia · Timed Allocation",
      image: "/assets/coin-britannia.png", mint: "The Royal Mint", meta: "1 oz · 99.99 fine · allocation",
      priceUsd: 2531, premiumPct: 6.0, supply: 80, remaining: 31, endsAt: iso(20 * HOUR), bids: [], extendedCount: 0,
    },
    {
      id: "drop-kangaroo-dutch", kind: "AUCTION", auctionStyle: "DUTCH", title: "Kangaroo 5-Coin Sleeve · Dutch",
      image: "/assets/coin-kangaroo.png", mint: "The Perth Mint", meta: "5 × 1 oz · price falls hourly",
      priceUsd: 12950, startBidUsd: 13400, bidIncrementUsd: 50, premiumPct: 8.5, supply: 6, remaining: 4,
      endsAt: iso(14 * HOUR), bids: [{ bidder: "L. F••", amountUsd: 13100, at: iso(-2 * HOUR) }], extendedCount: 0,
    },
  ];

  const otcQuotes: OtcQuote[] = [
    {
      id: "RM-OTC-0031", userId: "u-mei", requestText: "400 oz gold allocation, laddered over 2 weeks, wire settlement.",
      notionalUsd: 955000, metal: "gold", status: "QUOTED", quotedPremiumPct: 2.9,
      wireInstructions: "Fedwire · Rockwell Metals Treasury · ABA 0260-0959-3 · ref RM-OTC-0031", createdAt: iso(-2 * DAY),
    },
  ];

  const audit: AuditLog[] = [
    { id: nid("RM-AUD"), actorId: "s-marcus", actorName: "Marcus Webb", action: "INVENTORY_INTAKE", resourceType: "InventoryLot", resourceId: "RM-LOT-3330", before: null, after: `{"units":22,"assay":"pass"}`, ip: "10.4.1.22", at: iso(-4 * DAY) },
    { id: nid("RM-AUD"), actorId: "s-elena", actorName: "Elena Diaz", action: "ORDER_DISPATCHED", resourceType: "Order", resourceId: "RM-ORD-1006", before: `{"status":"FULFILLMENT_QUEUE"}`, after: `{"status":"DISPATCHED"}`, ip: "10.4.2.11", at: iso(-1.5 * DAY) },
    { id: nid("RM-AUD"), actorId: "s-sarah", actorName: "Sarah Okafor", action: "KYC_CLEARED", resourceType: "User", resourceId: "u-mei", before: `{"kycTier":"TIER_2"}`, after: `{"kycTier":"TIER_3"}`, ip: "10.4.3.09", at: iso(-12 * DAY) },
  ];

  const pricing: PricingSettings = {
    spotFeed: "Composite XAU/XAG/XPT · 250ms ticks",
    basePremiumPct: { gold: 5.5, silver: 12.0, platinum: 7.5 },
    tierDiscounts: { qty5: 0.01, qty20: 0.02 },
    surcharges: { wire: 0.004, card: 0.039 },
    sellbackSpreadPct: 0.5,
    loyaltyDiscountPct: 0.5,
    updatedAt: now, updatedBy: "s-victoria",
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: now, users, orders, holdings, shipments, sellbacks, tickets,
    audit, inventory, drops, otcQuotes,
    vaultPlans: [{ userId: "u-adrian", weeklyUsd: 250, active: true, productId: COINS.buffalo.productId, nextRunAt: iso(3 * DAY), totalInvestedUsd: 4250 }],
    pricing,
  };
}

// ————— persistence —————
//
// The domain logic below is synchronous over one in-memory document. Loading
// and saving go through a StoreAdapter (app/lib/rm-store.ts): the local JSON
// file in development, a Postgres row (Supabase) on any multi-instance host.
// Writes are optimistic — `save(doc, versionIRead)` — and `transact()` retries
// an action when another instance committed first.

type StoreState = {
  adapter: StoreAdapter;
  doc: RmDb | null;
  version: number | null;
  /** Mutations since the last commit. */
  dirty: boolean;
  checkedAt: number;
};

let store: StoreState | null = null;

function state(): StoreState {
  if (!store) store = { adapter: createStore(), doc: null, version: null, dirty: false, checkedAt: 0 };
  return store;
}

export const storeName = () => state().adapter.name;

/**
 * Brings a loaded document up to the current schema and applies environment
 * bootstrap (operator promotion). Returns the document to use and whether it
 * needs to be written back.
 */
function migrate(loaded: RmDb | null): { doc: RmDb; changed: boolean } {
  let doc = loaded;
  let changed = false;

  if (!doc || typeof doc.schemaVersion !== "number" || doc.schemaVersion < 2) {
    // v1 stores predate credentials: nobody could sign in. Re-seed.
    if (doc) console.warn("[rm-db] store schema is stale — re-seeding");
    doc = seed();
    changed = true;
  }

  if (doc.schemaVersion < 3) {
    const ids = new Set<string>(SEED_USER_IDS);
    for (const u of doc.users) u.seeded = ids.has(u.id);
    doc.schemaVersion = 3;
    changed = true;
  }

  // Demo data only: the seeded drops and auctions carry fixed end times, so a
  // store seeded days ago shows every drop as closed. Roll them forward by
  // their original window while demo mode is on. Real drops are never touched.
  if (DEMO_MODE) {
    const now = Date.now();
    for (const d of doc.drops) {
      const seededAt = Date.parse(doc.seededAt) || now;
      const windowMs = Math.max(3600_000, Date.parse(d.endsAt) - seededAt);
      if (Date.parse(d.endsAt) < now) {
        d.endsAt = new Date(now + windowMs).toISOString();
        d.extendedCount = 0;
        changed = true;
      }
    }
  }

  const admins = bootstrapAdminEmails();
  if (admins.length) {
    for (const u of doc.users) {
      if (admins.includes(u.email.toLowerCase()) && u.role !== "SUPER_ADMIN" && !u.seeded) {
        const before = { role: u.role };
        u.role = "SUPER_ADMIN";
        u.kycTier = "TIER_3";
        u.kycStatus = "CLEARED";
        log(doc, "system", "ROLE_BOOTSTRAPPED", "User", u.id, before, { role: u.role, via: "RM_BOOTSTRAP_ADMIN_EMAILS" });
        changed = true;
      }
    }
  }

  return { doc, changed };
}

/**
 * Loads (or refreshes) the document from the store. Call at the top of every
 * request. Cheap when nothing changed: one version probe, no document fetch.
 * `maxAgeMs` lets read-only paths skip even the probe for a short window.
 */
export async function openDb(opts: { maxAgeMs?: number } = {}): Promise<RmDb> {
  const s = state();
  const now = Date.now();

  if (s.doc && s.dirty) return s.doc; // uncommitted work in flight — keep it
  if (s.doc && s.version !== null) {
    if (now - s.checkedAt < (opts.maxAgeMs ?? 0)) return s.doc;
    const v = await s.adapter.version();
    if (v === s.version) {
      s.checkedAt = now;
      return s.doc;
    }
  }

  let snap = await s.adapter.load();
  if (!snap) snap = await s.adapter.create(seed());
  const m = migrate(snap.doc);
  s.doc = m.doc;
  s.version = snap.version;
  s.checkedAt = now;
  s.dirty = m.changed;
  if (m.changed) await commitDb();
  return s.doc;
}

/**
 * Synchronous access for the domain functions. In file mode the document is
 * lazily loaded on first use (tests and scripts rely on this); in postgres
 * mode `openDb()` must have run first — there is no sync network read.
 */
export function getDb(): RmDb {
  const s = state();
  if (s.doc) return s.doc;
  if (s.adapter instanceof FileStore) {
    const snap = s.adapter.loadSync();
    const m = migrate(snap?.doc ?? null);
    s.doc = m.doc;
    s.version = snap?.version ?? null;
    s.dirty = m.changed || !snap;
    if (s.dirty) {
      s.version = s.adapter.saveSync(s.doc, s.version);
      s.dirty = false;
    }
    return s.doc;
  }
  throw new StoreUnavailable("Ledger not opened: await openDb() before using the store on this driver.");
}

/** Marks the in-memory document as changed. Persisted by commitDb()/transact(). */
export function saveDb() {
  const s = state();
  if (s.doc) s.dirty = true;
}

/** Writes pending changes with an optimistic version check. Throws StoreConflict on a lost race. */
export async function commitDb(): Promise<void> {
  const s = state();
  if (!s.doc || !s.dirty) return;
  s.version = await s.adapter.save(s.doc, s.version ?? 0);
  s.dirty = false;
  s.checkedAt = Date.now();
}

/** Drops uncommitted changes so a failed request cannot leak half a transition into the next one. */
export function discardDb() {
  const s = state();
  s.doc = null;
  s.version = null;
  s.dirty = false;
  s.checkedAt = 0;
}

/**
 * Runs `fn` against a fresh document and commits. If another instance wrote in
 * between, the document is reloaded and `fn` re-run (up to 4 attempts). Any
 * other failure discards the uncommitted document.
 */
export async function transact<T>(fn: () => T | Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await openDb();
    try {
      const result = await fn();
      await commitDb();
      return result;
    } catch (e) {
      const s = state();
      if (s.dirty) discardDb();
      if (e instanceof StoreConflict && attempt < 4) continue;
      throw e;
    }
  }
}

/** Test/maintenance hook: forget the loaded document and (optionally) swap the adapter. */
export function _resetStoreForTests(adapter?: StoreAdapter) {
  store = adapter ? { adapter, doc: null, version: null, dirty: false, checkedAt: 0 } : null;
}

/**
 * Strips credentials and, for a customer, narrows every collection to that
 * customer's own records. This is the only shape allowed to leave the server.
 */
export function projectDb(actor: Actor): PublicRmDb {
  const db = getDb();
  const staff = isStaff(actor?.role);
  const strip = (u: User): PublicUser => {
    const { passwordHash: _pw, ...rest } = u;
    return rest;
  };

  const self = actor ? db.users.find((u) => u.id === actor.userId) ?? null : null;
  const session = self
    ? { userId: self.id, name: self.fullName, email: self.email, role: self.role }
    : null;

  if (staff) {
    return { ...db, users: db.users.map(strip), staffView: true, session };
  }

  const uid = actor?.userId ?? null;
  if (!uid) {
    // Signed out: nothing personal, only the public marketing surfaces.
    return {
      ...db, users: [], orders: [], holdings: [], shipments: [], sellbacks: [],
      tickets: [], audit: [], inventory: [], otcQuotes: [], vaultPlans: [],
      staffView: false, session: null,
    };
  }

  const mine = <T extends { userId?: string | null }>(xs: T[]) => xs.filter((x) => x.userId === uid);
  return {
    ...db,
    users: db.users.filter((u) => u.id === uid).map(strip),
    orders: mine(db.orders),
    holdings: mine(db.holdings),
    shipments: mine(db.shipments),
    sellbacks: mine(db.sellbacks),
    tickets: mine(db.tickets),
    otcQuotes: mine(db.otcQuotes),
    vaultPlans: mine(db.vaultPlans),
    // Vault bay layout and the staff audit ledger are not customer-visible.
    inventory: [],
    audit: [],
    staffView: false,
    session,
  };
}

/** Replaces the document with a fresh seed. Persisted by the enclosing transact(). */
export function resetDb(): RmDb {
  const s = state();
  s.doc = seed();
  s.dirty = true;
  return s.doc;
}

// ————— audit —————

function actorName(db: RmDb, id: string) {
  return db.users.find((u) => u.id === id)?.fullName ?? "System";
}

function log(db: RmDb, actorId: string, action: string, resourceType: string, resourceId: string, before: unknown, after: unknown) {
  db.audit.unshift({
    id: nid("RM-AUD"), actorId, actorName: actorName(db, actorId), action, resourceType, resourceId,
    before: before == null ? null : JSON.stringify(before),
    after: after == null ? null : JSON.stringify(after),
    ip: "127.0.0.1", at: iso(),
  });
  if (db.audit.length > 500) db.audit.length = 500;
}

// ————— domain actions —————

// Request bodies are untyped by nature; every action validates the fields it reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;

const CHECKPOINT_ROUTE: { label: string; location: string }[] = [
  { label: "Manifest scanned · departed vault", location: "Rockwell Vault Facility, DE" },
  { label: "Armored line-haul", location: "Philadelphia hub, PA" },
  { label: "Custody transfer verified", location: "Regional secure depot" },
  { label: "Out for delivery · armored courier", location: "Destination city" },
  { label: "Delivered · direct signature + photo ID", location: "Destination address" },
];

function findOrder(db: RmDb, id: string): Order {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw new Error(`Unknown order ${id}`);
  return o;
}

function setOrderStatus(db: RmDb, o: Order, status: OrderStatus, by: string) {
  const before = o.status;
  o.status = status;
  o.history.push({ status, at: iso(), by });
  log(db, by, "ORDER_" + status, "Order", o.id, { status: before }, { status });
}

function metalOfSku(sku: string) {
  if (sku.includes("-AG-")) return "silver";
  if (sku.includes("-PT-")) return "platinum";
  return "gold";
}

function mintHoldings(db: RmDb, o: Order, by: string) {
  for (const it of o.items) {
    for (const serial of it.allocatedSerials) {
      db.holdings.push({
        id: nid("RM-HLD"), userId: o.userId, orderId: o.id, productId: it.productId, title: it.title,
        image: it.image || "/assets/coin-buffalo.png", mint: it.mint, serialNumber: serial,
        purityPct: 99.99, weightOz: it.quantity >= 1 ? 1 : it.quantity, grade: "BU · Sealed",
        costUsd: it.unitPriceUsd, vaultBay: mkBay(), status: "VAULTED", lastVerifiedAt: iso(), createdAt: iso(),
      });
    }
  }
  log(db, by, "VAULT_PASSPORT_MINTED", "Order", o.id, null, { serials: o.items.flatMap((i) => i.allocatedSerials) });
}

// ————— credentials —————

export interface AuthResult {
  ok: boolean;
  user?: User;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 10;

/** Verifies an email + password pair. Returns a uniform failure so the response cannot enumerate accounts. */
export function authenticate(email: string, password: string): AuthResult {
  const db = getDb();
  const fail: AuthResult = { ok: false, error: "That email and password combination was not recognised." };
  if (!email || !password) return fail;

  const user = db.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) return fail;

  // Seeded demo accounts are inert unless demo mode is explicitly enabled.
  // Keyed on the explicit flag — the old id-prefix test also matched every
  // self-registered customer and locked them all out (audit: Critical).
  if (user.seeded === true && !DEMO_MODE) {
    return { ok: false, error: "Demo accounts are disabled. Open an account to continue." };
  }
  if (!verifyPassword(password, user.passwordHash)) return fail;
  if (user.frozen) return { ok: false, error: "This account is frozen. Contact support." };
  // The seed shares one demo hash across accounts; a stored hash must never
  // be reused for a different account after a reset, so re-hash on demand.
  if (!user.passwordHash?.startsWith("scrypt$")) return fail;

  log(db, user.id, "SESSION_MINTED", "User", user.id, null, { method: "password" });
  saveDb();
  return { ok: true, user };
}

export function registerUser(input: {
  fullName: string; email: string; phone?: string; password: string;
}): AuthResult {
  const db = getDb();
  const email = String(input.email || "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!input.fullName?.trim()) return { ok: false, error: "Enter your full name." };
  if ((input.password || "").length < MIN_PASSWORD) {
    return { ok: false, error: `Choose a password of at least ${MIN_PASSWORD} characters.` };
  }
  if (db.users.some((u) => u.email.toLowerCase() === email)) {
    return { ok: false, error: "An account already exists for that email. Sign in instead." };
  }

  const bootstrap = bootstrapAdminEmails().includes(email);
  const user: User = {
    id: nid("cus"), email, phone: input.phone?.trim() || "—", fullName: input.fullName.trim(),
    role: bootstrap ? "SUPER_ADMIN" : "CUSTOMER", accountType: "INDIVIDUAL",
    kycTier: bootstrap ? "TIER_3" : "TIER_1", kycStatus: bootstrap ? "CLEARED" : "UNVERIFIED",
    twoFactorEnabled: false, frozen: false,
    riskRating: "LOW", staffNotes: [], createdAt: iso(), seeded: false,
    passwordHash: hashPassword(input.password),
  };
  db.users.push(user);
  log(db, user.id, "ACCOUNT_CREATED", "User", user.id, null, { email: user.email, type: user.accountType, role: user.role });
  if (bootstrap) log(db, "system", "ROLE_BOOTSTRAPPED", "User", user.id, null, { role: user.role, via: "RM_BOOTSTRAP_ADMIN_EMAILS" });
  saveDb();
  return { ok: true, user };
}

// ————— authorization —————

export type Actor = { userId: string; role: Role } | null;

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403 = 403) {
    super(message);
  }
}

const ALL_STAFF: Role[] = ["SUPER_ADMIN", "OPS_VAULT", "LOGISTICS", "COMPLIANCE", "SUPPORT"];

/**
 * Who may run what. Every action must appear here — an action with no entry is
 * refused, so adding one without deciding its policy fails closed.
 *
 * "self" actions are rewritten to act on the caller's own id before dispatch,
 * so a client-supplied userId can never redirect them at somebody else.
 */
const ACTION_POLICY: Record<string, { roles: Role[] | "SELF"; self?: boolean }> = {
  // customer self-service — always scoped to the caller
  kycSubmit: { roles: "SELF", self: true },
  placeOrder: { roles: "SELF", self: true },
  requestSellback: { roles: "SELF", self: true },
  requestWithdrawal: { roles: "SELF", self: true },
  setVaultPlan: { roles: "SELF", self: true },
  createTicket: { roles: "SELF", self: true },
  createOtcRequest: { roles: "SELF", self: true },
  placeBid: { roles: "SELF", self: true },
  claimDrop: { roles: "SELF", self: true },
  ticketReply: { roles: "SELF", self: true },

  // order flow
  confirmPayment: { roles: ["SUPER_ADMIN", "SUPPORT", "OPS_VAULT"] },
  startAssay: { roles: ["SUPER_ADMIN", "OPS_VAULT"] },
  allocateOrder: { roles: ["SUPER_ADMIN", "OPS_VAULT"] },
  packScan: { roles: ["SUPER_ADMIN", "LOGISTICS", "OPS_VAULT"] },
  dispatchOrder: { roles: ["SUPER_ADMIN", "LOGISTICS"] },
  advanceShipment: { roles: ["SUPER_ADMIN", "LOGISTICS"] },
  flagShipmentException: { roles: ["SUPER_ADMIN", "LOGISTICS"] },
  cancelOrder: { roles: ["SUPER_ADMIN", "SUPPORT"] },
  dispatchWithdrawal: { roles: ["SUPER_ADMIN", "LOGISTICS", "OPS_VAULT"] },

  // desks
  sellbackTransition: { roles: ["SUPER_ADMIN", "SUPPORT", "OPS_VAULT"] },
  ticketSet: { roles: ["SUPER_ADMIN", "SUPPORT"] },
  quoteOtc: { roles: ["SUPER_ADMIN", "SUPPORT"] },
  intakeLot: { roles: ["SUPER_ADMIN", "OPS_VAULT"] },

  // risk & config
  kycSet: { roles: ["SUPER_ADMIN", "COMPLIANCE"] },
  freezeCustomer: { roles: ["SUPER_ADMIN", "COMPLIANCE"] },
  addStaffNote: { roles: ALL_STAFF },
  updatePricing: { roles: ["SUPER_ADMIN"] },
  setRole: { roles: ["SUPER_ADMIN"] },

  // credentials
  changePassword: { roles: "SELF", self: true },
  resetPassword: { roles: ["SUPER_ADMIN", "SUPPORT"] },

  resetDemo: { roles: ["SUPER_ADMIN"] },
};

/** 16 chars from an unambiguous alphabet: ~90 bits, typed once, then replaced. */
function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.replace(/(.{4})(?=.)/g, "$1-");
}

const ALL_ROLES: Role[] = ["CUSTOMER", ...ALL_STAFF];

function authorize(action: string, actor: Actor, p: Payload): string {
  const policy = ACTION_POLICY[action];
  if (!policy) throw new AuthError(`Unknown action: ${action}`, 403);
  if (!actor) throw new AuthError("Sign in to continue.", 401);

  const user = getDb().users.find((u) => u.id === actor.userId);
  if (!user) throw new AuthError("Session no longer valid.", 401);
  if (user.frozen) throw new AuthError("This account is frozen. Contact support.", 403);

  if (policy.roles === "SELF") {
    // Force every self-service action onto the caller's own identity.
    if (policy.self) {
      p.userId = actor.userId;
      if (action === "ticketReply") p.from = actor.userId;
    }
    return actor.userId;
  }

  if (!policy.roles.includes(actor.role)) {
    throw new AuthError("Your role does not carry access to this action.", 403);
  }
  return actor.userId;
}

/**
 * Binds physical serials to every line, decrements tracked lots, and either
 * mints vault passports (vault custody) or routes to pick/pack (delivery).
 * Idempotent: an already-allocated order is returned unchanged.
 */
function allocate(db: RmDb, o: Order, by: string): Order {
  if (["ALLOCATED", "FULFILLMENT_QUEUE", "DISPATCHED", "DELIVERED", "CANCELLED"].includes(o.status)) return o;
  for (const it of o.items) {
    while (it.allocatedSerials.length < it.quantity) {
      it.allocatedSerials.push(mkSerial(metalOfSku(it.sku), it.sku.split("-").pop() || it.sku));
    }
    const lot = db.inventory.find((l) => l.productId === it.productId);
    if (lot) lot.allocatedUnits = Math.min(lot.totalUnits, lot.allocatedUnits + it.quantity);
  }
  if (o.custody === "VAULT") {
    setOrderStatus(db, o, "ALLOCATED", by);
    mintHoldings(db, o, by);
  } else {
    setOrderStatus(db, o, "FULFILLMENT_QUEUE", by);
  }
  return o;
}

/**
 * Settlement pipeline for a paid order: assay, then allocation. Runs
 * server-side as the system actor the moment payment is confirmed, so the
 * customer never has to hold staff permissions to see their passport minted
 * (audit: Critical — success page called staff-only actions and 403'd).
 */
function settlePaidOrder(db: RmDb, o: Order) {
  if (o.status !== "PAID") return;
  setOrderStatus(db, o, "IN_ASSAY", "system");
  allocate(db, o, "system");
}

function nextOrderId(db: RmDb): string {
  let max = 1000;
  for (const o of db.orders) {
    const n = parseInt(o.id.replace(/^RM-ORD-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `RM-ORD-${ordinal(max + 1)}`;
}

export async function runAction(action: string, p: Payload, actor: Actor = null): Promise<{ result?: unknown }> {
  const db = getDb();
  // The actor is derived from the signed session, never from the request body,
  // so the audit ledger cannot be attributed to somebody else (audit S-02).
  const by: string = authorize(action, actor, p);

  switch (action) {
    // —— auth & kyc ——
    case "kycSubmit": {
      const user = db.users.find((u) => u.id === p.userId);
      if (!user) throw new Error("Unknown user");
      const before = { kycTier: user.kycTier, kycStatus: user.kycStatus };
      // No identity provider is connected, so a submission goes to the
      // compliance queue for a human decision — it does not clear itself.
      // A COMPLIANCE or SUPER_ADMIN operator advances it via kycSet.
      user.kycStatus = "IN_REVIEW";
      log(db, user.id, "KYC_SUBMITTED", "User", user.id, before, {
        kycStatus: user.kycStatus,
        requestedTier: p.targetTier === "TIER_3" ? "TIER_3" : "TIER_2",
      });
      saveDb();
      return { result: user };
    }
    case "kycSet": {
      const user = db.users.find((u) => u.id === p.userId);
      if (!user) throw new Error("Unknown user");
      const before = { kycTier: user.kycTier, kycStatus: user.kycStatus };
      if (p.kycTier) user.kycTier = p.kycTier;
      if (p.kycStatus) user.kycStatus = p.kycStatus;
      log(db, by, "KYC_REVIEWED", "User", user.id, before, { kycTier: user.kycTier, kycStatus: user.kycStatus });
      saveDb();
      return { result: user };
    }
    case "freezeCustomer": {
      const user = db.users.find((u) => u.id === p.userId);
      if (!user) throw new Error("Unknown user");
      const before = { frozen: user.frozen };
      user.frozen = !!p.frozen;
      log(db, by, user.frozen ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN", "User", user.id, before, { frozen: user.frozen });
      saveDb();
      return { result: user };
    }
    case "addStaffNote": {
      const user = db.users.find((u) => u.id === p.userId);
      if (!user) throw new Error("Unknown user");
      user.staffNotes.push(p.note);
      log(db, by, "STAFF_NOTE_ADDED", "User", user.id, null, { note: p.note });
      saveDb();
      return { result: user };
    }

    // —— checkout / orders ——
    case "placeOrder": {
      const user = db.users.find((u) => u.id === p.userId)!;

      // Rail / custody tier gates first, so a Tier 1 account choosing card
      // hears "verify your identity" rather than a price-drift message.
      const rail = String(p.payMethod ?? "").toUpperCase() as PayMethod;
      const cust = String(p.custody ?? "").toUpperCase() as Custody;
      if (PAY_METHODS.includes(rail) && CUSTODIES.includes(cust)) {
        const gate = tierViolation(user, { totalUsd: 0, payMethod: rail, custody: cust });
        if (gate) throw new OrderError("KYC_LIMIT", gate);
      }

      // Every line is re-priced on the server from the catalog and the quote
      // engine; the client's numbers are only compared, never stored.
      const priced = await priceOrder({
        items: p.items, payMethod: p.payMethod, custody: p.custody, address: p.address, shipTo: p.shipTo,
        expectedTotalUsd: p.totalUsd, lockToken: p.lockToken, drops: db.drops,
      });

      // KYC tier limits: rails, custody and single-order ceiling.
      const violation = tierViolation(user, priced);
      if (violation) throw new OrderError("KYC_LIMIT", violation);

      // Tracked lots must be able to cover the allocation.
      for (const it of priced.items) {
        const lot = db.inventory.find((l) => l.productId === it.productId);
        if (lot) {
          const free = lot.totalUnits - lot.allocatedUnits;
          if (free < it.quantity) {
            throw new OrderError("NO_STOCK", `Only ${free} of ${it.title} can be allocated right now.`);
          }
        }
      }

      // No payment processor is connected yet: instant rails are recorded as
      // PAID with a placeholder reference; wire waits for confirmPayment.
      const status: OrderStatus = priced.payMethod === "WIRE" ? "PENDING_PAYMENT" : "PAID";
      const now = iso();
      const order: Order = {
        id: nextOrderId(db), userId: p.userId, status, items: priced.items,
        totalUsd: priced.totalUsd, spotAtLock: priced.spotAtLock, lockedUntil: priced.lockedUntil,
        payMethod: priced.payMethod, custody: priced.custody, address: priced.address, shipTo: priced.shipTo, shipmentId: null,
        payRef:
          priced.payMethod === "WIRE" ? "FW-2026-" + Math.floor(80000 + Math.random() * 19999)
          : "ch_3" + Math.random().toString(36).slice(2, 10),
        history: [
          { status: "LOCK_INITIATED", at: now, by: p.userId },
          { status: "PENDING_PAYMENT", at: now, by: p.userId },
        ],
        createdAt: now,
      };
      if (status === "PAID") order.history.push({ status: "PAID", at: now, by: "system" });
      // Drop allocations are consumed here, atomically with the order — never
      // at "claim" time, so an abandoned checkout cannot strand units.
      for (const it of priced.items) {
        const d = db.drops.find((x) => x.id === it.productId);
        if (d) d.remaining = Math.max(0, d.remaining - it.quantity);
      }
      db.orders.unshift(order);
      log(db, p.userId, "ORDER_PLACED", "Order", order.id, null, {
        total: order.totalUsd, pay: order.payMethod, custody: order.custody, pricedAgainst: priced.pricedAgainst,
      });
      if (status === "PAID") settlePaidOrder(db, order);
      saveDb();
      return { result: order };
    }
    case "confirmPayment": {
      const o = findOrder(db, p.orderId);
      setOrderStatus(db, o, "PAID", by);
      saveDb();
      return { result: o };
    }
    case "startAssay": {
      const o = findOrder(db, p.orderId);
      setOrderStatus(db, o, "IN_ASSAY", by);
      saveDb();
      return { result: o };
    }
    case "allocateOrder": {
      // Vault technician binds physical serials; vault custody mints passports,
      // delivery custody routes to the pick/pack queue.
      const o = allocate(db, findOrder(db, p.orderId), by);
      saveDb();
      return { result: o };
    }
    case "packScan": {
      // Barcode/QR scan station: serial must match the order's allocation.
      const o = findOrder(db, p.orderId);
      const it = o.items.find((i) => i.allocatedSerials.includes(p.serial));
      if (!it) throw new Error(`Serial ${p.serial} does not match order ${o.id} — halt and re-verify.`);
      if (!it.packedSerials.includes(p.serial)) it.packedSerials.push(p.serial);
      if (p.tebSeal) it.tebSeal = p.tebSeal;
      log(db, by, "PACK_SCAN_VERIFIED", "Order", o.id, null, { serial: p.serial, teb: p.tebSeal ?? it.tebSeal });
      saveDb();
      return { result: o };
    }
    case "dispatchOrder": {
      const o = findOrder(db, p.orderId);
      const carrier: Carrier = p.carrier || "BRINKS";
      const shp: Shipment = {
        id: nid("RM-SHP"), orderId: o.id, userId: o.userId, kind: "ORDER", carrier,
        trackingNumber: (carrier === "BRINKS" ? "BRK-" : carrier === "MALCA_AMIT" ? "MAL-" : "FDX-") + Math.floor(10000 + Math.random() * 89999) + "-" + Math.floor(1000 + Math.random() * 8999),
        tamperSealBarcode: o.items[0]?.tebSeal || "TEB-" + Math.floor(80000 + Math.random() * 19999) + "-A",
        insurancePolicy: "LLD-250M-" + Math.floor(8000 + Math.random() * 1999),
        status: "IN_TRANSIT",
        checkpoints: [{ ...CHECKPOINT_ROUTE[0], at: iso() }],
        eta: iso(2 * DAY),
        address: o.address || "Allocated vault transfer",
        contents: o.items.map((i) => `${i.title} ×${i.quantity}`).join(", "),
        signatureName: null, signatureAt: null, createdAt: iso(),
      };
      db.shipments.unshift(shp);
      o.shipmentId = shp.id;
      setOrderStatus(db, o, "DISPATCHED", by);
      log(db, by, "SHIPMENT_CREATED", "Shipment", shp.id, null, { carrier: CARRIER_LABEL[carrier], tracking: shp.trackingNumber });
      saveDb();
      return { result: { order: o, shipment: shp } };
    }
    case "advanceShipment": {
      const s = db.shipments.find((x) => x.id === p.shipmentId);
      if (!s) throw new Error("Unknown shipment");
      const next = CHECKPOINT_ROUTE[s.checkpoints.length];
      if (!next) return { result: s };
      s.checkpoints.push({ ...next, at: iso() });
      if (s.checkpoints.length >= CHECKPOINT_ROUTE.length) {
        s.status = "DELIVERED";
        s.signatureName = p.signatureName || "Recipient · ID matched";
        s.signatureAt = iso();
        if (s.orderId) {
          const o = findOrder(db, s.orderId);
          setOrderStatus(db, o, "DELIVERED", by);
        }
        for (const h of db.holdings) {
          if (h.status === "TRANSIT" && s.contents.includes(h.title)) h.status = "SOLD_BACK";
        }
      }
      log(db, by, "SHIPMENT_CHECKPOINT", "Shipment", s.id, null, { checkpoint: s.checkpoints[s.checkpoints.length - 1].label });
      saveDb();
      return { result: s };
    }
    case "flagShipmentException": {
      const s = db.shipments.find((x) => x.id === p.shipmentId);
      if (!s) throw new Error("Unknown shipment");
      s.status = "EXCEPTION";
      s.checkpoints.push({ label: "Exception · " + (p.reason || "transit anomaly flagged"), location: "Carrier network", at: iso() });
      log(db, by, "SHIPMENT_EXCEPTION", "Shipment", s.id, null, { reason: p.reason });
      saveDb();
      return { result: s };
    }
    case "cancelOrder": {
      const o = findOrder(db, p.orderId);
      setOrderStatus(db, o, "CANCELLED", by);
      saveDb();
      return { result: o };
    }

    // —— sell-backs ——
    case "requestSellback": {
      const serials: string[] = p.serials || [];
      // Ownership check: a serial that is not the caller's own is not sellable
      // by them, regardless of what the request body claims.
      const holdings = db.holdings.filter(
        (h) => serials.includes(h.serialNumber) && h.userId === p.userId && h.status === "VAULTED",
      );
      if (!holdings.length) throw new Error("Select at least one vaulted serial you own.");
      // Record only the serials that passed the ownership check.
      const ownedSerials = holdings.map((h) => h.serialNumber);
      const sb: SellBackRequest = {
        id: nid("RM-SB"), userId: p.userId, serials: ownedSerials,
        title: p.title || holdings[0]?.title || "Holding",
        quantity: ownedSerials.length,
        lockedBidUsd: p.lockedBidUsd, spreadPct: db.pricing.sellbackSpreadPct,
        payout: "WIRE", status: "REQUESTED", payoutRef: null, createdAt: iso(),
      };
      for (const h of holdings) h.status = "DELIVERY_REQUESTED";
      db.sellbacks.unshift(sb);
      log(db, p.userId, "SELLBACK_REQUESTED", "SellBack", sb.id, null, { serials: ownedSerials, bid: sb.lockedBidUsd });
      saveDb();
      return { result: sb };
    }
    case "sellbackTransition": {
      const sb = db.sellbacks.find((x) => x.id === p.id);
      if (!sb) throw new Error("Unknown sell-back");
      const before = sb.status;
      sb.status = p.status;
      if (p.status === "DISBURSED") {
        sb.payoutRef = "FW-2026-" + Math.floor(80000 + Math.random() * 19999);
        for (const h of db.holdings) if (sb.serials.includes(h.serialNumber)) h.status = "SOLD_BACK";
      }
      if (p.status === "REJECTED") {
        for (const h of db.holdings) if (sb.serials.includes(h.serialNumber)) h.status = "VAULTED";
      }
      log(db, by, "SELLBACK_" + p.status, "SellBack", sb.id, { status: before }, { status: sb.status, payoutRef: sb.payoutRef });
      saveDb();
      return { result: sb };
    }

    // —— physical withdrawal ——
    case "requestWithdrawal": {
      const serials: string[] = Array.isArray(p.serials) ? p.serials.map(String) : [];
      // Only serials that are actually sitting in the vault — one already in a
      // sell-back or an earlier withdrawal cannot ship twice.
      const chosen = db.holdings.filter(
        (h) => serials.includes(h.serialNumber) && h.userId === p.userId && h.status === "VAULTED",
      );
      if (!chosen.length) throw new Error("Select at least one vaulted serial you own.");
      const carrier: Carrier = p.carrier || "BRINKS";
      const shp: Shipment = {
        id: nid("RM-SHP"), orderId: null, userId: p.userId, kind: "WITHDRAWAL", carrier,
        trackingNumber: (carrier === "BRINKS" ? "BRK-" : carrier === "MALCA_AMIT" ? "MAL-" : "FDX-") + Math.floor(10000 + Math.random() * 89999) + "-" + Math.floor(1000 + Math.random() * 8999),
        tamperSealBarcode: "TEB-" + Math.floor(80000 + Math.random() * 19999) + "-W",
        insurancePolicy: "LLD-250M-" + Math.floor(8000 + Math.random() * 1999),
        status: "PREPARING", checkpoints: [], eta: iso(3 * DAY),
        address: p.address || "On file", contents: chosen.map((h) => `${h.title} · ${h.serialNumber}`).join(", "),
        signatureName: null, signatureAt: null, createdAt: iso(),
      };
      for (const h of chosen) h.status = "DELIVERY_REQUESTED";
      db.shipments.unshift(shp);
      log(db, p.userId, "WITHDRAWAL_REQUESTED", "Shipment", shp.id, null, { serials, carrier: CARRIER_LABEL[carrier] });
      saveDb();
      return { result: shp };
    }
    case "dispatchWithdrawal": {
      const s = db.shipments.find((x) => x.id === p.shipmentId);
      if (!s) throw new Error("Unknown shipment");
      s.status = "IN_TRANSIT";
      s.checkpoints.push({ ...CHECKPOINT_ROUTE[0], at: iso() });
      for (const h of db.holdings) {
        if (h.status === "DELIVERY_REQUESTED" && s.contents.includes(h.serialNumber)) h.status = "TRANSIT";
      }
      log(db, by, "WITHDRAWAL_DISPATCHED", "Shipment", s.id, null, { tracking: s.trackingNumber });
      saveDb();
      return { result: s };
    }

    // —— vaultplan ——
    case "setVaultPlan": {
      let plan = db.vaultPlans.find((v) => v.userId === p.userId);
      const before = plan ? { ...plan } : null;
      if (!plan) {
        plan = { userId: p.userId, weeklyUsd: 250, active: false, productId: "buffalo-1oz", nextRunAt: iso(7 * DAY), totalInvestedUsd: 0 };
        db.vaultPlans.push(plan);
      }
      if (p.weeklyUsd != null) plan.weeklyUsd = p.weeklyUsd;
      if (p.active != null) plan.active = p.active;
      if (p.productId) plan.productId = p.productId;
      plan.nextRunAt = iso(7 * DAY);
      log(db, p.userId, "VAULTPLAN_UPDATED", "VaultPlan", p.userId, before, { weeklyUsd: plan.weeklyUsd, active: plan.active });
      saveDb();
      return { result: plan };
    }

    // —— support / otc / claims ——
    case "createTicket": {
      const subject = String(p.subject ?? "").trim();
      const text = String(p.text ?? "").trim();
      if (!subject || subject.length > 200) throw new Error("Enter a subject (up to 200 characters).");
      if (!text || text.length > 4000) throw new Error("Enter a message (up to 4,000 characters).");
      // A linked order must be the caller's own.
      const orderId =
        typeof p.orderId === "string" && db.orders.some((o) => o.id === p.orderId && o.userId === p.userId)
          ? p.orderId
          : null;
      const kind: SupportTicket["kind"] = p.kind === "OTC" || p.kind === "CLAIM" ? p.kind : "GENERAL";
      const priority: TicketPriority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(p.priority) ? p.priority : "MEDIUM";
      const t: SupportTicket = {
        id: nid("RM-TCK"), userId: p.userId, orderId, kind,
        subject, priority, status: "OPEN", assignee: null,
        messages: [{ from: p.userId, fromName: actorName(db, p.userId), staff: false, text, at: iso() }],
        createdAt: iso(),
      };
      db.tickets.unshift(t);
      log(db, p.userId, "TICKET_OPENED", "Ticket", t.id, null, { subject: t.subject, kind: t.kind });
      saveDb();
      return { result: t };
    }
    case "ticketReply": {
      const t = db.tickets.find((x) => x.id === p.id);
      if (!t) throw new Error("Unknown ticket");
      const sender = db.users.find((u) => u.id === p.from);
      const staff = !!sender && sender.role !== "CUSTOMER";
      // Customers may only post on their own threads (audit: High — IDOR).
      if (!staff && t.userId !== p.from) throw new AuthError("You can only reply on your own tickets.", 403);
      const text = String(p.text ?? "").trim();
      if (!text || text.length > 4000) throw new Error("Enter a message (up to 4,000 characters).");
      t.messages.push({ from: p.from, fromName: sender?.fullName ?? "You", staff, text, at: iso() });
      if (staff && t.status === "OPEN") t.status = "IN_PROGRESS";
      if (staff && !t.assignee) t.assignee = p.from;
      log(db, p.from, "TICKET_REPLY", "Ticket", t.id, null, { chars: String(p.text).length });
      saveDb();
      return { result: t };
    }
    case "ticketSet": {
      const t = db.tickets.find((x) => x.id === p.id);
      if (!t) throw new Error("Unknown ticket");
      const before = { status: t.status, priority: t.priority, assignee: t.assignee };
      if (p.status) t.status = p.status;
      if (p.priority) t.priority = p.priority;
      if (p.assignee !== undefined) t.assignee = p.assignee;
      log(db, by, "TICKET_UPDATED", "Ticket", t.id, before, { status: t.status, priority: t.priority, assignee: t.assignee });
      saveDb();
      return { result: t };
    }
    case "createOtcRequest": {
      const q: OtcQuote = {
        id: nid("RM-OTC"), userId: p.userId, requestText: p.requestText, notionalUsd: p.notionalUsd || 100000,
        metal: p.metal || "gold", status: "REQUESTED", quotedPremiumPct: null, wireInstructions: null, createdAt: iso(),
      };
      db.otcQuotes.unshift(q);
      log(db, p.userId, "OTC_REQUESTED", "OtcQuote", q.id, null, { notional: q.notionalUsd });
      saveDb();
      return { result: q };
    }
    case "quoteOtc": {
      const q = db.otcQuotes.find((x) => x.id === p.id);
      if (!q) throw new Error("Unknown OTC request");
      q.status = "QUOTED";
      q.quotedPremiumPct = p.premiumPct;
      q.wireInstructions = `Fedwire · Rockwell Metals Treasury · ABA 0260-0959-3 · ref ${q.id}`;
      log(db, by, "OTC_QUOTED", "OtcQuote", q.id, null, { premiumPct: q.quotedPremiumPct });
      saveDb();
      return { result: q };
    }

    // —— inventory ——
    case "intakeLot": {
      const lot: InventoryLot = {
        id: nid("RM-LOT"), productId: p.productId || "generic", sku: p.sku || "RM-AU-GEN", title: p.title,
        metal: p.metal || "gold", mint: p.mint || "U.S. Mint", bay: p.bay || mkBay(),
        unitWeightOz: p.unitWeightOz || 1, purityPct: p.purityPct || 99.99,
        assayMethod: "XRF + ultrasonic", ultrasonicPass: p.ultrasonicPass !== false,
        totalUnits: p.totalUnits || 1, allocatedUnits: 0, reorderAt: p.reorderAt || 10, intakeAt: iso(),
      };
      db.inventory.unshift(lot);
      log(db, by, "INVENTORY_INTAKE", "InventoryLot", lot.id, null, { units: lot.totalUnits, purity: lot.purityPct });
      saveDb();
      return { result: lot };
    }

    // —— pricing ——
    case "updatePricing": {
      const before = { ...db.pricing };
      db.pricing = { ...db.pricing, ...p.settings, updatedAt: iso(), updatedBy: by };
      log(db, by, "PRICING_UPDATED", "PricingSettings", "global", before, db.pricing);
      saveDb();
      return { result: db.pricing };
    }

    // —— drops / auctions ——
    case "placeBid": {
      const d = db.drops.find((x) => x.id === p.dropId);
      if (!d || d.kind !== "AUCTION") throw new Error("Unknown auction");
      if (new Date(d.endsAt).getTime() < Date.now()) throw new Error("Auction has closed.");
      const min = d.priceUsd + (d.bidIncrementUsd || 25);
      if (p.amountUsd < min) throw new Error(`Bid must be at least $${min.toLocaleString("en-US")}.`);
      const bidderUser = db.users.find((u) => u.id === p.userId);
      const parts = (bidderUser?.fullName || "Anon Bidder").split(" ");
      const masked = `${parts[0][0]}. ${(parts[1] || "X")[0]}••`;
      d.bids.unshift({ bidder: masked, amountUsd: p.amountUsd, at: iso() });
      d.priceUsd = p.amountUsd;
      // 30s anti-snipe extension
      const remainingMs = new Date(d.endsAt).getTime() - Date.now();
      if (remainingMs < 30_000) {
        d.endsAt = iso(remainingMs + 30_000);
        d.extendedCount += 1;
      }
      log(db, p.userId, "AUCTION_BID", "Drop", d.id, null, { amount: p.amountUsd, antiSnipe: remainingMs < 30_000 });
      saveDb();
      return { result: d };
    }
    case "claimDrop": {
      // Confirms the drop is open and has stock, and records intent. Units
      // are only consumed when the order settles (placeOrder), so a lock that
      // expires or is cancelled leaves nothing stranded (audit: Medium).
      const d = db.drops.find((x) => x.id === p.dropId);
      if (!d) throw new Error("Unknown drop");
      if (d.kind !== "DROP") throw new Error("Auction lots are won on the bid ladder.");
      if (new Date(d.endsAt).getTime() < Date.now()) throw new Error("This drop has closed.");
      if (d.remaining <= 0) throw new Error("Allocation exhausted.");
      log(db, p.userId, "DROP_CLAIM_OPENED", "Drop", d.id, null, { remaining: d.remaining });
      saveDb();
      return { result: d };
    }

    // —— credentials ——
    case "changePassword": {
      const user = db.users.find((u) => u.id === p.userId)!;
      const current = String(p.currentPassword ?? "");
      const next = String(p.newPassword ?? "");
      if (!verifyPassword(current, user.passwordHash)) throw new AuthError("Current password is incorrect.", 403);
      if (next.length < MIN_PASSWORD) throw new Error(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      if (next === current) throw new Error("Choose a password you have not used before.");
      user.passwordHash = hashPassword(next);
      user.mustChangePassword = false;
      log(db, user.id, "PASSWORD_CHANGED", "User", user.id, null, { method: "self-service" });
      saveDb();
      return { result: { ok: true } };
    }
    case "resetPassword": {
      // Support-desk recovery while no email delivery exists: a one-time
      // temporary password is generated server-side, shown once to the staff
      // member (who relays it over a verified channel), and must be replaced
      // by the customer on next use. Never logged in clear text.
      const user = db.users.find((u) => u.id === p.userId);
      if (!user) throw new Error("Unknown user");
      if (isStaff(user.role) && actor?.role !== "SUPER_ADMIN") throw new AuthError("Only a Super Admin can reset a staff password.", 403);
      if (user.id === by) throw new AuthError("Use Change password for your own account.", 403);
      const temporary = generateTemporaryPassword();
      user.passwordHash = hashPassword(temporary);
      user.mustChangePassword = true;
      log(db, by, "PASSWORD_RESET", "User", user.id, null, { by: actorName(db, by), mustChange: true });
      saveDb();
      return { result: { temporaryPassword: temporary, userId: user.id, email: user.email } };
    }

    case "setRole": {
      // Operator lifecycle outside demo mode: a SUPER_ADMIN promotes/demotes.
      const target = db.users.find((u) => u.id === p.userId);
      if (!target) throw new Error("Unknown user");
      const role = String(p.role ?? "") as Role;
      if (!ALL_ROLES.includes(role)) throw new Error("Unknown role");
      if (target.id === by) throw new AuthError("You cannot change your own role.", 403);
      if (target.seeded && !DEMO_MODE) throw new Error("Seeded demo accounts cannot hold roles outside demo mode.");
      if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
        const others = db.users.filter(
          (u) => u.id !== target.id && u.role === "SUPER_ADMIN" && !u.frozen && (!u.seeded || DEMO_MODE),
        );
        if (!others.length) throw new Error("At least one active Super Admin must remain.");
      }
      const before = { role: target.role };
      target.role = role;
      if (isStaff(role)) {
        target.kycTier = "TIER_3";
        target.kycStatus = "CLEARED";
      }
      log(db, by, "ROLE_CHANGED", "User", target.id, before, { role });
      saveDb();
      return { result: target };
    }

    case "resetDemo": {
      if (!DEMO_MODE) throw new AuthError("Demo reset is disabled on this environment.", 403);
      resetDb();
      return { result: { ok: true } };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
