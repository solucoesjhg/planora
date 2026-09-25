import { describe, expect, it } from "vitest";
import { isRefused } from "@/lib/result";
import {
  BREACH_REFUSAL_THRESHOLD,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPasswordShape,
  isPasswordVerdict,
  judgeBreachCount,
} from "./passwords";

const reason = (password: string, identity = {}) => {
  const decision = checkPasswordShape(password, identity);
  return isRefused(decision) ? decision.reason : "allowed";
};

describe("length", () => {
  it(`refuses anything under ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(reason("sete123")).toBe("too-short");
    expect(reason("oito1234")).toBe("allowed");
  });

  /**
   * Better Auth refuses past 128 inside the endpoint, after the policy — so a
   * long password used to pass the policy, spend the sign-up allowance, and be
   * refused anyway (ADR 0008). The policy says so first.
   */
  it(`refuses anything over ${MAX_PASSWORD_LENGTH} characters`, () => {
    const words = "trilha molhada de barro ";
    const exactly = words.repeat(6).slice(0, MAX_PASSWORD_LENGTH);

    expect(reason(exactly)).toBe("allowed");
    expect(reason(`${exactly}x`)).toBe("too-long");
  });
});

describe("what people actually pick", () => {
  it("refuses the passwords that top every breach corpus", () => {
    expect(reason("senha123")).toBe("too-common");
    expect(reason("password123")).toBe("too-common");
    expect(reason("brasil123")).toBe("too-common");
    expect(reason("planora2026")).toBe("too-common");
  });

  it("sees through accents and capitals", () => {
    expect(reason("SENHA123")).toBe("too-common");
    expect(reason("Sênha123")).toBe("too-common");
  });

  it("refuses a single repeated character and a straight run", () => {
    expect(reason("aaaaaaaa")).toBe("too-common");
    expect(reason("12345678")).toBe("too-common");
    expect(reason("abcdefgh")).toBe("too-common");
    expect(reason("87654321")).toBe("too-common");
  });

  it("refuses the person's own name or address inside the password", () => {
    const identity = { email: "henrique@example.com", name: "Henrique Zanella" };

    expect(reason("henrique2026", identity)).toBe("contains-identity");
    expect(reason("xxzanellaxx", identity)).toBe("contains-identity");
    // A short first name is not enough of a signal to refuse on.
    expect(reason("anaconda-verde", { name: "Ana" })).toBe("allowed");
  });

  it("allows a long passphrase with no symbols at all", () => {
    // The point of the policy: this is stronger than "Senha@123", and every
    // composition rule ever written would have rejected it.
    expect(reason("cavalo bateria grampo correto")).toBe("allowed");
  });
});

/**
 * The owner's decision of 2026-09-25 (ADR 0008): refuse what many people
 * chose, not everything that ever leaked. Refusing any appearance at all made
 * almost every password fail.
 */
describe("the breach count", () => {
  const judged = (count: number) => {
    const decision = judgeBreachCount(count);
    return isRefused(decision) ? decision.reason : "allowed";
  };

  it("accepts a password nobody has leaked, or only a few people have", () => {
    expect(judged(0)).toBe("allowed");
    expect(judged(1)).toBe("allowed");
    expect(judged(BREACH_REFUSAL_THRESHOLD - 1)).toBe("allowed");
  });

  it("refuses a password many people converged on", () => {
    expect(BREACH_REFUSAL_THRESHOLD).toBe(10);
    expect(judged(BREACH_REFUSAL_THRESHOLD)).toBe("breached");
    expect(judged(1_000_000)).toBe("breached");
  });
});

describe("a verdict from the wire", () => {
  it("is one of the names the check can answer with, and nothing else", () => {
    expect(isPasswordVerdict("accepted")).toBe(true);
    expect(isPasswordVerdict("breached")).toBe(true);
    expect(isPasswordVerdict("unavailable")).toBe(true);
    expect(isPasswordVerdict("ok")).toBe(false);
    expect(isPasswordVerdict(undefined)).toBe(false);
    expect(isPasswordVerdict(10)).toBe(false);
  });
});
