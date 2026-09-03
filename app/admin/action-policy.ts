// Client-side mirror of ACTION_POLICY in app/lib/rm-db.ts (the server is the
// authority — this map only decides what the ops UI *offers*, so a role never
// sees a button the server will refuse). Keep the two in lockstep when a new
// action lands; tests/action-policy.test.ts cross-checks them.

import { ROLE_LABEL, type Role } from "../lib/rm-types";

export const ALL_STAFF: Role[] = ["SUPER_ADMIN", "OPS_VAULT", "LOGISTICS", "COMPLIANCE", "SUPPORT"];

/** "SELF" = any signed-in caller, scoped to their own records. */
export const ACTION_POLICY: Record<string, Role[] | "SELF"> = {
  // customer self-service
  kycSubmit: "SELF",
  placeOrder: "SELF",
  requestSellback: "SELF",
  requestWithdrawal: "SELF",
  setVaultPlan: "SELF",
  createTicket: "SELF",
  createOtcRequest: "SELF",
  placeBid: "SELF",
  claimDrop: "SELF",
  ticketReply: "SELF",

  // order flow
  confirmPayment: ["SUPER_ADMIN", "SUPPORT", "OPS_VAULT"],
  startAssay: ["SUPER_ADMIN", "OPS_VAULT"],
  allocateOrder: ["SUPER_ADMIN", "OPS_VAULT"],
  packScan: ["SUPER_ADMIN", "LOGISTICS", "OPS_VAULT"],
  dispatchOrder: ["SUPER_ADMIN", "LOGISTICS"],
  advanceShipment: ["SUPER_ADMIN", "LOGISTICS"],
  flagShipmentException: ["SUPER_ADMIN", "LOGISTICS"],
  cancelOrder: ["SUPER_ADMIN", "SUPPORT"],
  dispatchWithdrawal: ["SUPER_ADMIN", "LOGISTICS", "OPS_VAULT"],

  // desks
  sellbackTransition: ["SUPER_ADMIN", "SUPPORT", "OPS_VAULT"],
  ticketSet: ["SUPER_ADMIN", "SUPPORT"],
  quoteOtc: ["SUPER_ADMIN", "SUPPORT"],
  intakeLot: ["SUPER_ADMIN", "OPS_VAULT"],

  // risk & config
  kycSet: ["SUPER_ADMIN", "COMPLIANCE"],
  freezeCustomer: ["SUPER_ADMIN", "COMPLIANCE"],
  addStaffNote: ALL_STAFF,
  updatePricing: ["SUPER_ADMIN"],
  setRole: ["SUPER_ADMIN"],

  // credentials
  changePassword: "SELF",
  resetPassword: ["SUPER_ADMIN", "SUPPORT"],

  resetDemo: ["SUPER_ADMIN"],

  // Catalog tooling routes (/api/match-jm, /api/synthesize-catalog,
  // /api/deploy-catalog, /api/catalog-batch, POST /api/catalog-progress) —
  // gated by app/lib/api-guard.ts requireStaff([...]). Not an rmAction; the
  // pseudo-action lets Catalog Studio use the same helper.
  catalogTooling: ["SUPER_ADMIN", "OPS_VAULT"],
};

/** Roles that may run `action`; empty for an unknown action. */
export function rolesFor(action: string): Role[] {
  const p = ACTION_POLICY[action];
  if (!p) return [];
  return p === "SELF" ? ["CUSTOMER", ...ALL_STAFF] : p;
}

/** Would the server accept `action` from `role`? Unknown actions are refused. */
export function canRun(role: Role | null | undefined, action: string): boolean {
  if (!role) return false;
  const p = ACTION_POLICY[action];
  if (!p) return false;
  if (p === "SELF") return true;
  return p.includes(role);
}

/** Tooltip copy for a control the current role cannot use. */
export function requirementLabel(action: string): string {
  const roles = rolesFor(action);
  if (!roles.length) return "This action is not available.";
  return `Requires ${roles.map((r) => ROLE_LABEL[r]).join(" or ")}.`;
}
