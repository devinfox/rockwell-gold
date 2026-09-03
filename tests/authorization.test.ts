import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(async () => {
  process.env.RM_SESSION_SECRET = "test-secret-that-is-definitely-long-enough-32";
  process.env.RM_DEMO_MODE = "true";
  process.env.RM_STORE_DRIVER = "file";
  // Isolated store: the suite must never touch the developer's data/db.json.
  const { _resetStoreForTests } = await import("../app/lib/rm-db");
  const { FileStore } = await import("../app/lib/rm-store");
  _resetStoreForTests(new FileStore(mkdtempSync(join(tmpdir(), "rm-auth-"))));
});

const load = async () => await import("../app/lib/rm-db");

describe("action authorization", () => {
  it("refuses every action without a session", async () => {
    const { runAction } = await load();
    for (const action of ["placeOrder", "kycSet", "updatePricing", "dispatchOrder", "resetDemo"]) {
      await expect(runAction(action, {}, null)).rejects.toThrow(/Sign in/i);
    }
  });

  it("refuses an unknown action", async () => {
    const { runAction } = await load();
    await expect(runAction("deleteEverything", {}, null)).rejects.toThrow();
  });

  it("stops a customer running staff actions", async () => {
    const { runAction, getDb } = await load();
    const customer = getDb().users.find((u) => u.role === "CUSTOMER")!;
    const actor = { userId: customer.id, role: customer.role };

    for (const action of ["kycSet", "freezeCustomer", "updatePricing", "dispatchOrder", "sellbackTransition", "setRole"]) {
      await expect(runAction(action, { userId: "s-admin" }, actor)).rejects.toThrow(/role does not carry access/i);
    }
  });

  it("stops one role reaching another role's tools", async () => {
    const { runAction, getDb } = await load();
    const logistics = getDb().users.find((u) => u.role === "LOGISTICS")!;
    // Logistics may dispatch, but must not rewrite pricing or clear KYC.
    await expect(runAction("updatePricing", { settings: {} }, { userId: logistics.id, role: "LOGISTICS" }))
      .rejects.toThrow(/role does not carry access/i);
    await expect(runAction("kycSet", { userId: "u-adrian", kycStatus: "CLEARED" }, { userId: logistics.id, role: "LOGISTICS" }))
      .rejects.toThrow(/role does not carry access/i);
  });

  it("forces a self-service action onto the caller's own id", async () => {
    const { runAction, getDb } = await load();
    const db = getDb();
    const me = db.users.find((u) => u.id === "u-adrian")!;
    const someoneElse = db.users.find((u) => u.id === "u-mei")!;

    // Claim to be acting for another user; the server must ignore that.
    await runAction("kycSubmit", { userId: someoneElse.id }, { userId: me.id, role: "CUSTOMER" });

    expect(getDb().users.find((u) => u.id === me.id)!.kycStatus).toBe("IN_REVIEW");
    expect(getDb().users.find((u) => u.id === someoneElse.id)!.kycStatus).not.toBe("IN_REVIEW");
  });

  it("attributes the audit entry to the real actor, not a claimed one", async () => {
    const { runAction, getDb } = await load();
    const compliance = getDb().users.find((u) => u.role === "COMPLIANCE")!;

    await runAction(
      "kycSet",
      { userId: "u-jonas", kycStatus: "CLEARED", actorId: "u-adrian" },
      { userId: compliance.id, role: "COMPLIANCE" },
    );

    const entry = getDb().audit.find((a) => a.action === "KYC_REVIEWED");
    expect(entry?.actorId).toBe(compliance.id);
    expect(entry?.actorId).not.toBe("u-adrian");
    // put jonas back the way the seed had him for the order tests
    await runAction("kycSet", { userId: "u-jonas", kycStatus: "UNVERIFIED", kycTier: "TIER_1" }, { userId: compliance.id, role: "COMPLIANCE" });
  });

  it("blocks a frozen account entirely", async () => {
    const { runAction, getDb } = await load();
    const admin = getDb().users.find((u) => u.role === "SUPER_ADMIN")!;
    const victim = getDb().users.find((u) => u.id === "u-priya")!;

    await runAction("freezeCustomer", { userId: victim.id, frozen: true }, { userId: admin.id, role: "SUPER_ADMIN" });
    await expect(runAction("placeOrder", { items: [], totalUsd: 1 }, { userId: victim.id, role: "CUSTOMER" }))
      .rejects.toThrow(/frozen/i);

    await runAction("freezeCustomer", { userId: victim.id, frozen: false }, { userId: admin.id, role: "SUPER_ADMIN" });
  });
});

describe("ownership", () => {
  it("refuses a sell-back of serials the caller does not own", async () => {
    const { runAction, getDb } = await load();
    const db = getDb();
    const mine = db.users.find((u) => u.id === "u-adrian")!;
    const theirs = db.holdings.find((h) => h.userId !== mine.id && h.status === "VAULTED");

    if (theirs) {
      await expect(
        runAction("requestSellback", { serials: [theirs.serialNumber], lockedBidUsd: 1 }, { userId: mine.id, role: "CUSTOMER" }),
      ).rejects.toThrow(/own/i);
    }

    // A serial the caller does own is accepted.
    const own = getDb().holdings.find((h) => h.userId === mine.id && h.status === "VAULTED");
    if (own) {
      const res = await runAction(
        "requestSellback",
        { serials: [own.serialNumber], lockedBidUsd: 2500 },
        { userId: mine.id, role: "CUSTOMER" },
      );
      expect(res.result).toBeTruthy();
    }
  });

  it("refuses a withdrawal of a serial that is not sitting in the vault", async () => {
    const { runAction, getDb } = await load();
    // The sell-back above moved one of Adrian's serials to DELIVERY_REQUESTED.
    const moved = getDb().holdings.find((h) => h.userId === "u-adrian" && h.status !== "VAULTED");
    if (moved) {
      await expect(
        runAction("requestWithdrawal", { serials: [moved.serialNumber] }, { userId: "u-adrian", role: "CUSTOMER" }),
      ).rejects.toThrow(/vaulted/i);
    }
  });

  it("lets a customer reply only on their own tickets", async () => {
    const { runAction, getDb } = await load();
    const adriansTicket = getDb().tickets.find((t) => t.userId === "u-adrian")!;

    await expect(
      runAction("ticketReply", { id: adriansTicket.id, text: "injected" }, { userId: "u-mei", role: "CUSTOMER" }),
    ).rejects.toThrow(/own tickets/i);

    const before = adriansTicket.messages.length;
    await runAction("ticketReply", { id: adriansTicket.id, text: "mine" }, { userId: "u-adrian", role: "CUSTOMER" });
    expect(getDb().tickets.find((t) => t.id === adriansTicket.id)!.messages.length).toBe(before + 1);

    // Staff may reply anywhere.
    await runAction("ticketReply", { id: adriansTicket.id, text: "desk" }, { userId: "s-dev", role: "SUPPORT" });
    expect(getDb().tickets.find((t) => t.id === adriansTicket.id)!.messages.at(-1)?.staff).toBe(true);
  });

  it("only links a ticket to an order the caller owns", async () => {
    const { runAction, getDb } = await load();
    const someoneElsesOrder = getDb().orders.find((o) => o.userId !== "u-mei")!;
    const res = await runAction(
      "createTicket",
      { subject: "hello", text: "help", orderId: someoneElsesOrder.id },
      { userId: "u-mei", role: "CUSTOMER" },
    );
    expect((res.result as { orderId: string | null }).orderId).toBeNull();
  });
});

describe("roles", () => {
  it("lets a super admin promote, but never change their own role", async () => {
    const { runAction, getDb } = await load();
    const admin = getDb().users.find((u) => u.id === "s-admin")!;

    await runAction("setRole", { userId: "u-priya", role: "SUPPORT" }, { userId: admin.id, role: "SUPER_ADMIN" });
    expect(getDb().users.find((u) => u.id === "u-priya")!.role).toBe("SUPPORT");
    expect(getDb().audit[0].action).toBe("ROLE_CHANGED");

    await expect(runAction("setRole", { userId: admin.id, role: "CUSTOMER" }, { userId: admin.id, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/own role/i);
    await expect(runAction("setRole", { userId: "u-priya", role: "WIZARD" }, { userId: admin.id, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/unknown role/i);

    await runAction("setRole", { userId: "u-priya", role: "CUSTOMER" }, { userId: admin.id, role: "SUPER_ADMIN" });
  });
});

describe("data scoping", () => {
  it("returns nothing personal to an anonymous caller", async () => {
    const { projectDb } = await load();
    const view = projectDb(null);
    expect(view.users).toHaveLength(0);
    expect(view.orders).toHaveLength(0);
    expect(view.holdings).toHaveLength(0);
    expect(view.audit).toHaveLength(0);
    expect(view.session).toBeNull();
    expect(view.staffView).toBe(false);
  });

  it("shows a customer only their own records, and no credentials", async () => {
    const { projectDb, getDb } = await load();
    const me = getDb().users.find((u) => u.id === "u-adrian")!;
    const view = projectDb({ userId: me.id, role: "CUSTOMER" });

    expect(view.users.every((u) => u.id === me.id)).toBe(true);
    expect(view.orders.every((o) => o.userId === me.id)).toBe(true);
    expect(view.holdings.every((h) => h.userId === me.id)).toBe(true);
    expect(view.audit).toHaveLength(0);
    expect(view.inventory).toHaveLength(0);
    for (const u of view.users) {
      expect((u as Record<string, unknown>).passwordHash).toBeUndefined();
    }
  });

  it("gives staff the full store but still strips credentials", async () => {
    const { projectDb, getDb } = await load();
    const admin = getDb().users.find((u) => u.role === "SUPER_ADMIN")!;
    const view = projectDb({ userId: admin.id, role: "SUPER_ADMIN" });

    expect(view.staffView).toBe(true);
    expect(view.users.length).toBeGreaterThan(1);
    for (const u of view.users) {
      expect((u as Record<string, unknown>).passwordHash).toBeUndefined();
    }
  });
});

describe("credentials", () => {
  it("rejects a wrong password and does not leak whether the account exists", async () => {
    const { authenticate } = await load();
    const bad = authenticate("customer@rockwell.demo", "not-the-password");
    const missing = authenticate("nobody@nowhere.test", "not-the-password");
    expect(bad.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(bad.error).toBe(missing.error);
  });

  it("accepts the demo password while demo mode is on", async () => {
    const { authenticate } = await load();
    const res = authenticate("customer@rockwell.demo", "rockwell-demo-2026");
    expect(res.ok).toBe(true);
    expect(res.user?.role).toBe("CUSTOMER");
  });

  it("enforces a password floor on registration", async () => {
    const { registerUser } = await load();
    expect(registerUser({ fullName: "A B", email: "short@test.dev", password: "tiny" }).ok).toBe(false);
    expect(registerUser({ fullName: "A B", email: "not-an-email", password: "longenoughpassword" }).ok).toBe(false);
  });
});
