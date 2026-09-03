"use client";

// Admin & Operations realm shell (blueprint Part 2): RBAC gate,
// ops sidebar with live queue counts, and shared helpers.

import React from "react";
import Link from "next/link";
import { useRm, type RmSession } from "../lib/use-rm";
import { useSpot, fmtSpot, fmtChange, spotDir } from "../components/use-spot";
import type { RmDb, Role } from "../lib/rm-types";
import { ROLE_LABEL } from "../lib/rm-types";
import BrandLogo from "../components/brand-logo";
import { ALL_STAFF, rolesFor } from "./action-policy";

export type OpsRm = ReturnType<typeof useRm>;

const STAFF: Role[] = ALL_STAFF;

interface NavItem {
  href: string;
  label: string;
  /** Roles the entry is listed for — i.e. roles that can actually use the page. */
  roles: Role[];
  /** Roles that may still open the page read-only (defaults to `roles`). */
  viewRoles?: Role[];
  count?: (db: RmDb) => number;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Command",
    items: [
      { href: "/admin", label: "Command center", roles: STAFF },
      // Every mutating Catalog Studio call is gated SUPER_ADMIN/OPS_VAULT by
      // app/lib/api-guard.ts; other staff may look (GET /api/catalog-progress)
      // but the entry is listed only for roles that can run it.
      { href: "/admin/catalog-studio", label: "Catalog Studio (AI)", roles: rolesFor("catalogTooling"), viewRoles: STAFF },
      { href: "/admin/audit-logs", label: "Audit ledger", roles: ["SUPER_ADMIN", "OPS_VAULT", "COMPLIANCE"] },
    ],
  },
  {
    group: "Order flow",
    items: [
      { href: "/admin/orders", label: "Orders · OMS", roles: STAFF, count: (db) => db.orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status)).length },
      { href: "/admin/fulfillment", label: "Pick / pack / ship", roles: ["SUPER_ADMIN", "LOGISTICS", "OPS_VAULT"], count: (db) => db.orders.filter((o) => o.status === "FULFILLMENT_QUEUE").length + db.shipments.filter((s) => s.status === "PREPARING").length },
      { href: "/admin/shipments", label: "Transit control", roles: ["SUPER_ADMIN", "LOGISTICS"], count: (db) => db.shipments.filter((s) => s.status === "IN_TRANSIT" || s.status === "EXCEPTION").length },
      { href: "/admin/sell-backs", label: "Sell-back desk", roles: ["SUPER_ADMIN", "SUPPORT", "OPS_VAULT"], count: (db) => db.sellbacks.filter((s) => s.status === "REQUESTED" || s.status === "APPROVED").length },
    ],
  },
  {
    group: "Vault",
    items: [
      { href: "/admin/inventory", label: "Stock registry", roles: ["SUPER_ADMIN", "OPS_VAULT"] },
      { href: "/admin/inventory/intake", label: "Mint intake", roles: ["SUPER_ADMIN", "OPS_VAULT"] },
      { href: "/admin/inventory/allocate", label: "Serial allocation", roles: ["SUPER_ADMIN", "OPS_VAULT"], count: (db) => db.orders.filter((o) => o.status === "PAID" || o.status === "IN_ASSAY").length },
    ],
  },
  {
    group: "Clients & risk",
    items: [
      { href: "/admin/customers", label: "Customer 360", roles: STAFF },
      { href: "/admin/compliance", label: "Compliance / KYC", roles: ["SUPER_ADMIN", "COMPLIANCE"], count: (db) => db.users.filter((u) => u.role === "CUSTOMER" && u.kycStatus !== "CLEARED").length },
      { href: "/admin/pricing-engine", label: "Pricing engine", roles: ["SUPER_ADMIN"] },
    ],
  },
  {
    group: "Desk",
    items: [
      { href: "/admin/support", label: "Support desk", roles: ["SUPER_ADMIN", "SUPPORT"], count: (db) => db.tickets.filter((t) => t.status !== "RESOLVED").length },
      { href: "/admin/support/otc-quotes", label: "OTC quotes", roles: ["SUPER_ADMIN", "SUPPORT"], count: (db) => db.otcQuotes.filter((q) => q.status === "REQUESTED").length },
    ],
  },
];

/** May this session open `href` (read-only access counts)? */
export function allowed(session: RmSession | null, href: string): boolean {
  if (!session || !STAFF.includes(session.role)) return false;
  if (session.role === "SUPER_ADMIN") return true;
  const item = NAV.flatMap((g) => g.items).find((i) => i.href === href);
  return !item || item.roles.includes(session.role) || (item.viewRoles ?? []).includes(session.role);
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function OpsShell({ rm, current, title, meta, children, actions }: {
  rm: OpsRm;
  current: string;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { db, session } = rm;
  const spot = useSpot();

  // gate: staff session required. proxy.ts already redirects unauthenticated
  // visitors; this is the in-app fallback for a session that expires mid-visit.
  if (db && (!session || !STAFF.includes(session.role))) {
    return (
      <main className="wrap rm-main" style={{ maxWidth: 720 }}>
        <div className="rm-head">
          <span className="section__index num">ADMIN / RBAC</span>
          <h1 className="rm-title">Staff console.</h1>
          <p className="rm-sub">
            This realm needs a staff session — every action lands in the immutable audit ledger
            under your name.
          </p>
        </div>
        <div className="rm-actions">
          <Link className="btn btn--gold" href={`/auth/sign-in?next=${encodeURIComponent(current)}`}>
            Sign in with your staff account
          </Link>
          <Link className="btn btn--ghost" href="/">← Back to the storefront</Link>
        </div>
      </main>
    );
  }

  const role: Role = session?.role ?? "CUSTOMER";
  const can = (item: NavItem) => role === "SUPER_ADMIN" || item.roles.includes(role);
  const permitted = allowed(session, current);

  return (
    <div className="ops">
      <aside className="ops__side">
        <Link className="ops__brand" href="/admin" aria-label="Rockwell Ops">
          <BrandLogo descriptor="OPS" size={26} />
          <span>OPS</span>
        </Link>
        {NAV.map((g) => {
          const items = g.items.filter(can);
          if (!items.length) return null;
          return (
            <React.Fragment key={g.group}>
              <span className="ops__group">{g.group}</span>
              {items.map((i) => {
                const n = i.count && db ? i.count(db) : 0;
                return (
                  <Link key={i.href} className={`ops__link${current === i.href ? " is-here" : ""}`} href={i.href}>
                    {i.label}
                    {n > 0 && <span className="n num">{n}</span>}
                  </Link>
                );
              })}
            </React.Fragment>
          );
        })}
        <span className="ops__group">Realm</span>
        <Link className="ops__link" href="/">← Storefront</Link>
        <Link className="ops__link" href="/auth/sign-in">Switch role</Link>
        <div className="ops__user">
          <span className="ops__av num">{session ? initials(session.name) : "…"}</span>
          <div className="ops__usermeta">
            <b>{session?.name ?? "…"}</b>
            <span className="num">{session ? ROLE_LABEL[session.role] : ""}</span>
          </div>
        </div>
      </aside>

      <main className="ops__main">
        <div className="ops__topbar">
          <h1 className="ops__title">{title}</h1>
          <div className="ops__topmeta num">
            <span className="st" data-tone={spot?.live ? "live" : "muted"}>
              <span className="tag__pulse" aria-hidden="true"></span> {spot?.live ? "spot feed live" : "indicative spot"}
            </span>
            <span>
              XAU {fmtSpot(spot, "XAU")}
              {spot?.live && (
                <i className="chg" data-dir={spotDir(spot, "XAU")} style={{ fontStyle: "normal" }}>
                  {" "}{fmtChange(spot, "XAU")}
                </i>
              )}
            </span>
            {meta}
            {actions}
          </div>
        </div>
        {!permitted && db ? (
          <div className="rm-panel" style={{ borderColor: "var(--loss)" }}>
            <p className="rm-panel__k" style={{ color: "var(--loss)" }}>Insufficient role</p>
            <p className="rm-note">{session ? ROLE_LABEL[session.role] : "This role"} doesn&apos;t carry access to this tool. <Link href="/auth/sign-in" style={{ color: "var(--gold-ink)" }}>Switch role →</Link></p>
          </div>
        ) : !db ? (
          <p className="rm-sub num">Aggregating real-time exchange metrics…</p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
