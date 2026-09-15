import { describe, expect, it } from "vitest";
import { senderFromEnvironment } from "./sender";

/**
 * Which sender a process gets, from its environment alone. The rule that
 * matters is the production one: a deployment that forgot its key must fail
 * loudly, and a production build that wants the local inbox — the E2E suite —
 * must say so by name.
 */
describe("senderFromEnvironment", () => {
  it("uses Resend whenever a key is present", () => {
    expect(senderFromEnvironment({ RESEND_API_KEY: "re_x", NODE_ENV: "production" }).name).toBe(
      "resend",
    );
    expect(senderFromEnvironment({ RESEND_API_KEY: "re_x", NODE_ENV: "development" }).name).toBe(
      "resend",
    );
  });

  it("uses the local inbox in development", () => {
    expect(senderFromEnvironment({ NODE_ENV: "development" }).name).toBe("mailpit");
  });

  it("refuses to run production without a key", () => {
    expect(() => senderFromEnvironment({ NODE_ENV: "production" })).toThrow(
      /RESEND_API_KEY is required in production/,
    );
  });

  it("uses the local inbox in production only when asked for by name", () => {
    expect(
      senderFromEnvironment({ NODE_ENV: "production", EMAIL_DRIVER: "mailpit" }).name,
    ).toBe("mailpit");
  });
});
