import { describe, expect, it } from "vitest";
import { assertBreachSwitchAllowed, breachChecksOn } from "./breach-switch";

describe("the breach lookup switch", () => {
  it("is on unless the E2E switch turns it off", () => {
    expect(breachChecksOn({})).toBe(true);
    expect(breachChecksOn({ DISABLE_BREACH_CHECK: "1" })).toBe(false);
    expect(breachChecksOn({ DISABLE_BREACH_CHECK: "1", VERCEL_ENV: "preview" })).toBe(false);
  });

  /**
   * ADR 0008: the switch used to be obeyed wherever it was set. Production now
   * refuses to build with it, and a server that starts with it keeps checking
   * rather than failing every sign-in.
   */
  it("cannot turn the lookup off in production", () => {
    const production = { DISABLE_BREACH_CHECK: "1", VERCEL_ENV: "production" };

    expect(() => assertBreachSwitchAllowed(production)).toThrow(/DISABLE_BREACH_CHECK/);
    expect(breachChecksOn(production)).toBe(true);
  });

  it("lets every other build through", () => {
    expect(() => assertBreachSwitchAllowed({})).not.toThrow();
    expect(() => assertBreachSwitchAllowed({ VERCEL_ENV: "production" })).not.toThrow();
    expect(() =>
      assertBreachSwitchAllowed({ DISABLE_BREACH_CHECK: "1", VERCEL_ENV: "preview" }),
    ).not.toThrow();
  });
});
