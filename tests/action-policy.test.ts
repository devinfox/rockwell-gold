import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACTION_POLICY, ALL_STAFF, canRun, rolesFor, requirementLabel } from "../app/admin/action-policy";

// The client map exists so the ops UI never offers a control the server will
// refuse. It has to stay in lockstep with ACTION_POLICY in app/lib/rm-db.ts,
// which is module-private, so this parses the source block instead.
function serverPolicy(): Record<string, string[] | "SELF"> {
  const src = readFileSync(fileURLToPath(new URL("../app/lib/rm-db.ts", import.meta.url)), "utf8");
  const start = src.indexOf("const ACTION_POLICY");
  const end = src.indexOf("};", start);
  const block = src.slice(start, end);
  const out: Record<string, string[] | "SELF"> = {};
  for (const m of block.matchAll(/^\s*(\w+):\s*\{\s*roles:\s*(ALL_STAFF|"SELF"|\[[^\]]*\])/gm)) {
    const [, name, roles] = m;
    if (roles === '"SELF"') out[name] = "SELF";
    else if (roles === "ALL_STAFF") out[name] = [...ALL_STAFF];
    else out[name] = [...roles.matchAll(/"(\w+)"/g)].map((r) => r[1]);
  }
  return out;
}

describe("client action policy mirrors the server", () => {
  const server = serverPolicy();

  it("parsed the server block", () => {
    expect(Object.keys(server).length).toBeGreaterThan(20);
    expect(server.dispatchOrder).toEqual(["SUPER_ADMIN", "LOGISTICS"]);
  });

  it("has every server action with identical roles", () => {
    for (const [action, roles] of Object.entries(server)) {
      expect(ACTION_POLICY[action], `missing client entry for ${action}`).toBeDefined();
      const client = ACTION_POLICY[action];
      if (roles === "SELF") expect(client).toBe("SELF");
      else expect([...(client as string[])].sort()).toEqual([...roles].sort());
    }
  });

  it("only adds the catalog-tooling pseudo-action beyond the server map", () => {
    const extra = Object.keys(ACTION_POLICY).filter((k) => !(k in server));
    expect(extra).toEqual(["catalogTooling"]);
    expect(ACTION_POLICY.catalogTooling).toEqual(["SUPER_ADMIN", "OPS_VAULT"]);
  });
});

describe("canRun", () => {
  it("refuses unknown actions and missing roles", () => {
    expect(canRun(null, "dispatchOrder")).toBe(false);
    expect(canRun("SUPER_ADMIN", "nope")).toBe(false);
  });
  it("applies role lists", () => {
    expect(canRun("LOGISTICS", "dispatchOrder")).toBe(true);
    expect(canRun("SUPPORT", "dispatchOrder")).toBe(false);
    expect(canRun("COMPLIANCE", "freezeCustomer")).toBe(true);
    expect(canRun("OPS_VAULT", "freezeCustomer")).toBe(false);
    expect(canRun("SUPPORT", "updatePricing")).toBe(false);
  });
  it("lets any signed-in caller run SELF actions", () => {
    expect(canRun("CUSTOMER", "placeOrder")).toBe(true);
    expect(rolesFor("placeOrder")).toContain("CUSTOMER");
  });
  it("labels the requirement with human role names", () => {
    expect(requirementLabel("dispatchOrder")).toBe("Requires Super Admin or Logistics & Fulfillment.");
  });
});
