// Shared types + constants for the Rockwell Metals system realm
// (auth / checkout / orders / vault custody / admin ops).
// The blueprint's PostgreSQL schema, expressed over the local JSON store.

export type Role =
  | "CUSTOMER"
  | "SUPER_ADMIN"
  | "OPS_VAULT"
  | "LOGISTICS"
  | "COMPLIANCE"
  | "SUPPORT";

export type KycTier = "TIER_1" | "TIER_2" | "TIER_3";
export type KycStatus = "UNVERIFIED" | "IN_REVIEW" | "CLEARED" | "FLAGGED";

export type OrderStatus =
  | "LOCK_INITIATED"
  | "PENDING_PAYMENT"
  | "PAID"
  | "IN_ASSAY"
  | "ALLOCATED"
  | "FULFILLMENT_QUEUE"
  | "DISPATCHED"
  | "DELIVERED"
  | "CANCELLED";

export type PayMethod = "WIRE" | "CARD";
export type Custody = "VAULT" | "DELIVERY";
export type Carrier = "BRINKS" | "FEDEX_PRIORITY" | "MALCA_AMIT";

export type HoldingStatus = "VAULTED" | "DELIVERY_REQUESTED" | "TRANSIT" | "SOLD_BACK";
export type SellBackStatus = "REQUESTED" | "APPROVED" | "DISBURSED" | "REJECTED";
export type ShipmentStatus = "PREPARING" | "IN_TRANSIT" | "EXCEPTION" | "DELIVERED";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface User {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: Role;
  accountType: "INDIVIDUAL" | "CORPORATE";
  kycTier: KycTier;
  kycStatus: KycStatus;
  twoFactorEnabled: boolean;
  frozen: boolean;
  riskRating: "LOW" | "MEDIUM" | "HIGH";
  staffNotes: string[];
  createdAt: string;
  /**
   * True only for the accounts created by the seed. Demo-mode gating keys off
   * this flag, never off the id prefix — every self-registered customer used
   * to be mistaken for a demo account and locked out (audit: Critical).
   */
  seeded?: boolean;
  /** Set when staff issued a temporary password; cleared by changePassword. */
  mustChangePassword?: boolean;
  /** scrypt digest. Server-side only — stripped from every API response. */
  passwordHash?: string;
}

/** A User with every server-only field removed. This is the only shape that may cross the wire. */
export type PublicUser = Omit<User, "passwordHash">;

export interface OrderItem {
  productId: string;
  sku: string;
  title: string;
  image: string;
  mint: string;
  quantity: number;
  unitPriceUsd: number;
  unitPremiumPct: number;
  allocatedSerials: string[];
  packedSerials: string[];
  tebSeal: string | null;
}

/** Structured delivery address for armored dispatch. */
export interface ShippingAddress {
  recipient: string;
  street: string;
  unit?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  phone: string;
}

export interface Order {
  id: string; // RM-ORD-XXXX
  userId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalUsd: number;
  spotAtLock: number;
  lockedUntil: string;
  payMethod: PayMethod;
  payRef: string; // tx hash / fedwire ref / stripe charge
  custody: Custody;
  /** One-line rendering of `shipTo` (kept for shipments, receipts and older orders). */
  address: string | null;
  shipTo?: ShippingAddress | null;
  shipmentId: string | null;
  history: { status: OrderStatus; at: string; by: string }[];
  createdAt: string;
}

export interface VaultHolding {
  id: string;
  userId: string;
  orderId: string | null;
  productId: string;
  title: string;
  image: string;
  mint: string;
  serialNumber: string; // RM-AU-BUF-7741
  purityPct: number;
  weightOz: number;
  grade: string;
  costUsd: number;
  vaultBay: string; // e.g. "Bay B-04 · Shelf 2 · Row 11"
  status: HoldingStatus;
  lastVerifiedAt: string;
  createdAt: string;
}

export interface ShipmentCheckpoint {
  label: string;
  location: string;
  at: string;
}

export interface Shipment {
  id: string; // RM-SHP-XXXX
  orderId: string | null;
  userId: string;
  kind: "ORDER" | "WITHDRAWAL";
  carrier: Carrier;
  trackingNumber: string;
  tamperSealBarcode: string;
  insurancePolicy: string;
  status: ShipmentStatus;
  checkpoints: ShipmentCheckpoint[];
  eta: string;
  address: string;
  contents: string;
  signatureName: string | null;
  signatureAt: string | null;
  createdAt: string;
}

export interface SellBackRequest {
  id: string; // RM-SB-XXXX
  userId: string;
  serials: string[];
  title: string;
  quantity: number;
  lockedBidUsd: number;
  spreadPct: number;
  payout: "WIRE";
  status: SellBackStatus;
  payoutRef: string | null;
  createdAt: string;
}

export interface TicketMessage {
  from: string; // user id or staff id
  fromName: string;
  staff: boolean;
  text: string;
  at: string;
}

export interface SupportTicket {
  id: string; // RM-TCK-XXXX
  userId: string;
  orderId: string | null;
  kind: "GENERAL" | "OTC" | "CLAIM";
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignee: string | null;
  messages: TicketMessage[];
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: string | null;
  after: string | null;
  ip: string;
  at: string;
}

export interface InventoryLot {
  id: string; // RM-LOT-XXXX
  productId: string;
  sku: string;
  title: string;
  metal: string;
  mint: string;
  bay: string;
  unitWeightOz: number;
  purityPct: number;
  assayMethod: string;
  ultrasonicPass: boolean;
  totalUnits: number;
  allocatedUnits: number;
  reorderAt: number;
  intakeAt: string;
}

export interface Drop {
  id: string;
  kind: "DROP" | "AUCTION";
  auctionStyle?: "ENGLISH" | "DUTCH";
  title: string;
  image: string;
  mint: string;
  meta: string;
  priceUsd: number; // list price (drop) or current bid (auction)
  startBidUsd?: number;
  bidIncrementUsd?: number;
  premiumPct: number;
  supply: number;
  remaining: number;
  endsAt: string;
  bids: { bidder: string; amountUsd: number; at: string }[];
  extendedCount: number;
}

export interface OtcQuote {
  id: string; // RM-OTC-XXXX
  userId: string;
  requestText: string;
  notionalUsd: number;
  metal: string;
  status: "REQUESTED" | "QUOTED" | "ACCEPTED" | "EXPIRED";
  quotedPremiumPct: number | null;
  wireInstructions: string | null;
  createdAt: string;
}

export interface PricingSettings {
  spotFeed: string;
  basePremiumPct: { gold: number; silver: number; platinum: number };
  tierDiscounts: { qty5: number; qty20: number }; // fraction, e.g. 0.01
  surcharges: { wire: number; card: number };
  sellbackSpreadPct: number;
  loyaltyDiscountPct: number;
  updatedAt: string;
  updatedBy: string;
}

export interface VaultPlan {
  userId: string;
  weeklyUsd: number;
  active: boolean;
  productId: string;
  nextRunAt: string;
  totalInvestedUsd: number;
}

export interface RmDb {
  /** Bumped whenever the seed shape changes so a stale data/db.json is re-seeded. */
  schemaVersion: number;
  seededAt: string;
  users: User[];
  orders: Order[];
  holdings: VaultHolding[];
  shipments: Shipment[];
  sellbacks: SellBackRequest[];
  tickets: SupportTicket[];
  audit: AuditLog[];
  inventory: InventoryLot[];
  drops: Drop[];
  otcQuotes: OtcQuote[];
  vaultPlans: VaultPlan[];
  pricing: PricingSettings;
}

/**
 * What the API is allowed to return: credentials stripped, and — for a customer
 * session — every collection already narrowed to that customer's own records.
 */
export interface PublicRmDb extends Omit<RmDb, "users"> {
  users: PublicUser[];
  /** True when the caller holds a staff role and is seeing the whole store. */
  staffView: boolean;
  /** The caller's own session, resolved server-side from the signed cookie. */
  session: { userId: string; name: string; email: string; role: Role } | null;
}

// ————— shared constants —————

/**
 * Reference marks used ONLY to price the seed data's historical orders.
 * Nothing live reads these — every storefront surface goes through getSpot().
 * Kept in step with the fallback marks in app/lib/spot.ts.
 */
export const SPOT = { XAU: 4492.4, XAG: 67.19, XPT: 1835 };

export const ORDER_FLOW: OrderStatus[] = [
  "LOCK_INITIATED",
  "PENDING_PAYMENT",
  "PAID",
  "IN_ASSAY",
  "ALLOCATED",
  "FULFILLMENT_QUEUE",
  "DISPATCHED",
  "DELIVERED",
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  LOCK_INITIATED: "Lock initiated",
  PENDING_PAYMENT: "Pending payment",
  PAID: "Paid",
  IN_ASSAY: "In assay",
  ALLOCATED: "Allocated · vaulted",
  FULFILLMENT_QUEUE: "Fulfillment queue",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered · signed",
  CANCELLED: "Cancelled",
};

export const CARRIER_LABEL: Record<Carrier, string> = {
  BRINKS: "Brinks Armored",
  FEDEX_PRIORITY: "FedEx Priority",
  MALCA_AMIT: "Malca-Amit",
};

export const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: "Customer",
  SUPER_ADMIN: "Super Admin",
  OPS_VAULT: "Operations & Vault",
  LOGISTICS: "Logistics & Fulfillment",
  COMPLIANCE: "Compliance & Risk",
  SUPPORT: "Support & Desk Broker",
};

export const TIER_LIMIT: Record<KycTier, string> = {
  TIER_1: "to $10,000 · card rail",
  TIER_2: "to $100,000 · wire, card, delivery",
  TIER_3: "$100,000+ · OTC desk, dedicated manager",
};

export const fmtUsd = (v: number, dp = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const fmtUsd0 = (v: number) => fmtUsd(v, 0);
