// Demo mode OFF: the production posture. Real accounts must work, seeded
// accounts must not, and the operator bootstrap must produce a SUPER_ADMIN.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rm-reg-"));

beforeAll(async () => {
  process.env.RM_SESSION_SECRET = "test-secret-that-is-definitely-long-enough-32";
  process.env.RM_DEMO_MODE = "false";
  process.env.RM_STORE_DRIVER = "file";
  process.env.RM_BOOTSTRAP_ADMIN_EMAILS = "ops@rockwell.test, second@rockwell.test";
  const { _resetStoreForTests } = await import("../app/lib/rm-db");
  const { FileStore } = await import("../app/lib/rm-store");
  _resetStoreForTests(new FileStore(dir));
});

const load = async () => await import("../app/lib/rm-db");

describe("registration with demo mode off", () => {
  it("lets a self-registered customer sign back in (regression: id-prefix lockout)", async () => {
    const { registerUser, authenticate } = await load();
    const reg = registerUser({ fullName: "Real Customer", email: "real@example.com", password: "a-long-password-1" });
    expect(reg.ok).toBe(true);
    expect(reg.user?.seeded).toBe(false);
    expect(reg.user?.role).toBe("CUSTOMER");

    const ok = authenticate("real@example.com", "a-long-password-1");
    expect(ok.ok).toBe(true);
    expect(ok.user?.id).toBe(reg.user?.id);

    const bad = authenticate("real@example.com", "wrong-password-x");
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toMatch(/demo/i);
  });

  it("keeps seeded demo accounts inert", async () => {
    const { authenticate, getDb } = await load();
    const seeded = getDb().users.find((u) => u.id === "s-admin")!;
    expect(seeded.seeded).toBe(true);
    const res = authenticate(seeded.email, "rockwell-demo-2026");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/demo accounts are disabled/i);
  });

  it("creates a bootstrap operator as SUPER_ADMIN on registration", async () => {
    const { registerUser, authenticate, getDb } = await load();
    const reg = registerUser({ fullName: "Ops Lead", email: "OPS@rockwell.test", password: "operator-password-1" });
    expect(reg.ok).toBe(true);
    expect(reg.user?.role).toBe("SUPER_ADMIN");
    expect(reg.user?.kycStatus).toBe("CLEARED");
    expect(authenticate("ops@rockwell.test", "operator-password-1").ok).toBe(true);
    expect(getDb().audit.some((a) => a.action === "ROLE_BOOTSTRAPPED")).toBe(true);
  });

  it("promotes an existing customer named in the bootstrap list on the next store open", async () => {
    const { registerUser, commitDb, _resetStoreForTests, openDb } = await load();
    const { FileStore } = await import("../app/lib/rm-store");

    // Register while NOT on the list, persist, then add to the list and reopen.
    process.env.RM_BOOTSTRAP_ADMIN_EMAILS = "ops@rockwell.test";
    const reg = registerUser({ fullName: "Late Admin", email: "second@rockwell.test", password: "another-password-1" });
    expect(reg.user?.role).toBe("CUSTOMER");
    await commitDb();

    process.env.RM_BOOTSTRAP_ADMIN_EMAILS = "ops@rockwell.test,second@rockwell.test";
    _resetStoreForTests(new FileStore(dir));
    const db = await openDb();
    expect(db.users.find((u) => u.email === "second@rockwell.test")!.role).toBe("SUPER_ADMIN");
  });

  it("migrates a version-2 document by flagging seeded users instead of re-seeding", async () => {
    const { _resetStoreForTests, openDb, commitDb, getDb } = await load();
    const { FileStore } = await import("../app/lib/rm-store");
    const { writeFileSync } = await import("node:fs");

    // Simulate the pre-fix store: schemaVersion 2, no seeded flags, one real customer.
    const seedDoc = getDb();
    const legacy = JSON.parse(JSON.stringify(seedDoc));
    legacy.schemaVersion = 2;
    for (const u of legacy.users) delete u.seeded;
    legacy.users.push({ ...legacy.users[0], id: "u-ABC123", email: "legacy@example.com", role: "CUSTOMER" });

    const dir2 = mkdtempSync(join(tmpdir(), "rm-mig-"));
    const store = new FileStore(dir2);
    writeFileSync(store.path, JSON.stringify(legacy));

    _resetStoreForTests(store);
    const db = await openDb();
    await commitDb();
    expect(db.schemaVersion).toBe(3);
    expect(db.users.find((u) => u.id === "s-admin")!.seeded).toBe(true);
    // A pre-fix customer whose id happened to start with "u-" is a real account.
    expect(db.users.find((u) => u.id === "u-ABC123")!.seeded).toBe(false);
    expect(db.users.length).toBe(legacy.users.length);
  });
});

describe("password lifecycle", () => {
  it("lets a customer change their own password and refuses a wrong current password", async () => {
    const { registerUser, authenticate, runAction } = await load();
    const reg = registerUser({ fullName: "Pw Tester", email: "pw@example.com", password: "initial-password-1" });
    const actor = { userId: reg.user!.id, role: "CUSTOMER" as const };
    await expect(runAction("changePassword", { currentPassword: "nope-nope-nope", newPassword: "another-password-2" }, actor)).rejects.toThrow(/current password/i);
    await expect(runAction("changePassword", { currentPassword: "initial-password-1", newPassword: "short" }, actor)).rejects.toThrow(/at least 10/i);
    await runAction("changePassword", { currentPassword: "initial-password-1", newPassword: "another-password-2" }, actor);
    expect(authenticate("pw@example.com", "initial-password-1").ok).toBe(false);
    expect(authenticate("pw@example.com", "another-password-2").ok).toBe(true);
  });

  it("lets support issue a one-time temporary password that must be replaced", async () => {
    const { registerUser, authenticate, runAction, getDb } = await load();
    const reg = registerUser({ fullName: "Reset Me", email: "reset@example.com", password: "forgotten-password-1" });
    const ops = getDb().users.find((u) => u.email === "ops@rockwell.test")!; // bootstrap SUPER_ADMIN from earlier
    const res = await runAction("resetPassword", { userId: reg.user!.id }, { userId: ops.id, role: "SUPER_ADMIN" });
    const temp = (res.result as { temporaryPassword: string }).temporaryPassword;
    expect(temp).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(authenticate("reset@example.com", "forgotten-password-1").ok).toBe(false);
    const ok = authenticate("reset@example.com", temp);
    expect(ok.ok).toBe(true);
    expect(ok.user?.mustChangePassword).toBe(true);
    // the ledger records who did it, never the password itself
    const entry = getDb().audit.find((a) => a.action === "PASSWORD_RESET" && a.resourceId === reg.user!.id)!;
    expect(entry.actorId).toBe(ops.id);
    expect(JSON.stringify(entry)).not.toContain(temp);
    // a customer cannot reset anyone, and staff cannot reset themselves
    await expect(runAction("resetPassword", { userId: reg.user!.id }, { userId: reg.user!.id, role: "CUSTOMER" })).rejects.toThrow(/role does not carry/i);
    await expect(runAction("resetPassword", { userId: ops.id }, { userId: ops.id, role: "SUPER_ADMIN" })).rejects.toThrow(/own account/i);
  });
});
