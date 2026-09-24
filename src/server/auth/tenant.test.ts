import { describe, expect, it } from "vitest";
import { can, grantableRoles, tenantContext, type Role } from "./tenant";

const as = (role: Role) => tenantContext("workspace", "user", role);

describe("grantableRoles", () => {
  it("never offers ownership, not even to the owner", () => {
    expect(grantableRoles(as("owner"))).toStrictEqual([
      "admin",
      "manager",
      "member",
      "viewer",
    ]);
  });

  it("lets an admin grant what an admin holds and nothing above it", () => {
    expect(grantableRoles(as("admin"))).toStrictEqual([
      "admin",
      "manager",
      "member",
      "viewer",
    ]);
  });

  it("offers nothing to anybody who cannot manage members", () => {
    for (const role of ["manager", "member", "viewer"] as const) {
      expect(can(as(role), "manage-members")).toBe(false);
      expect(grantableRoles(as(role))).toStrictEqual([]);
    }
  });
});
