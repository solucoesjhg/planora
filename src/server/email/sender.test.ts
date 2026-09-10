import { describe, expect, it } from "vitest";
import { senderFromEnvironment } from "./sender";

describe("choosing a sender", () => {
  const base = {
    EMAIL_FROM: "Planora <no-reply@planora.app>",
    NODE_ENV: "development",
  } as NodeJS.ProcessEnv;

  it("uses Resend whenever a key is configured", () => {
    const sender = senderFromEnvironment({ ...base, RESEND_API_KEY: "re_test" });
    expect(sender.name).toBe("resend");
  });

  it("uses the local inbox in development", () => {
    const sender = senderFromEnvironment(base);
    expect(sender.name).toBe("mailpit");
  });

  /**
   * The failure this prevents is invisible until somebody tries to sign up:
   * the local inbox is a machine that does not exist in production, so every
   * verification email would throw at the moment an account is created.
   */
  it("refuses to fall back to a local inbox in production", () => {
    expect(() =>
      senderFromEnvironment({ ...base, NODE_ENV: "production" as const }),
    ).toThrow(/RESEND_API_KEY is required in production/);
  });
});
