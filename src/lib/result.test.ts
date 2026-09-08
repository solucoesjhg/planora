import { describe, expect, it } from "vitest";
import { allowed, isOk, isRefused, ok, refused } from "./result";

describe("result", () => {
  it("carries the reason a refusal happened", () => {
    const decision = refused("blocked", "TSK-14");

    expect(isRefused(decision)).toBe(true);
    expect(decision.reason).toBe("blocked");
    expect(decision.detail).toBe("TSK-14");
  });

  it("omits detail rather than storing undefined", () => {
    expect(refused("checklist")).toStrictEqual({
      kind: "refused",
      reason: "checklist",
    });
  });

  it("separates a decision from an outcome", () => {
    expect(isRefused(allowed)).toBe(false);
    expect(isOk(ok(42))).toBe(true);
  });
});
