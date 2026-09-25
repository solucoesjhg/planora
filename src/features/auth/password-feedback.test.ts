import { describe, expect, it } from "vitest";
import type { PasswordVerdict } from "@/domain/passwords";
import { PASSWORD_FEEDBACK, PASSWORD_REFUSALS } from "@/lib/strings";
import {
  REMEMBERED_VERDICTS,
  feedbackStatus,
  passwordFeedback,
  remember,
  worthAsking,
} from "./password-feedback";

const good = "trilha molhada de barro";

describe("the password field", () => {
  it("says nothing but the hint while there is nothing, or while still typing", () => {
    expect(passwordFeedback("", {}, undefined, true)).toEqual({ kind: "idle" });
    expect(passwordFeedback("tril", {}, undefined, false)).toEqual({ kind: "idle" });
  });

  it("calls a short password short once the person stops", () => {
    expect(passwordFeedback("tril", {}, undefined, true)).toEqual({
      kind: "refused",
      reason: "too-short",
    });
  });

  it("refuses what the shape rules refuse, without waiting for the server", () => {
    expect(passwordFeedback("senha123", {}, undefined, false)).toEqual({
      kind: "refused",
      reason: "too-common",
    });
    expect(
      passwordFeedback("henrique2026", { name: "Henrique Zanella" }, "accepted", false),
    ).toEqual({ kind: "refused", reason: "contains-identity" });
  });

  it("is checking until the server answers, then says what it answered", () => {
    expect(passwordFeedback(good, {}, undefined, false)).toEqual({ kind: "checking" });
    expect(passwordFeedback(good, {}, "accepted", false)).toEqual({ kind: "accepted" });
    expect(passwordFeedback(good, {}, "breached", false)).toEqual({
      kind: "refused",
      reason: "breached",
    });
    expect(passwordFeedback(good, {}, "unavailable", false)).toEqual({ kind: "unavailable" });
  });

  it("asks the server only about a password the shape rules let through", () => {
    expect(worthAsking(good)).toBe(true);
    expect(worthAsking("")).toBe(false);
    expect(worthAsking("curta")).toBe(false);
    expect(worthAsking("senha123")).toBe(false);
    // The name rule is the form's: the server is asked regardless.
    expect(worthAsking("henrique2026")).toBe(true);
  });

  it("says each state in words, not only in colour", () => {
    expect(feedbackStatus({ kind: "idle" })).toEqual({
      tone: "neutral",
      text: PASSWORD_FEEDBACK.hint,
    });
    expect(feedbackStatus({ kind: "refused", reason: "breached" })).toEqual({
      tone: "danger",
      text: PASSWORD_REFUSALS.breached,
    });
    expect(feedbackStatus({ kind: "accepted" }).text).toBe(PASSWORD_FEEDBACK.accepted);
    expect(feedbackStatus({ kind: "unavailable" }).tone).toBe("neutral");
  });
});

describe("the verdicts the field remembers", () => {
  it("keeps the latest few, letting the oldest go", () => {
    let known: ReadonlyMap<string, PasswordVerdict> = new Map();
    for (let index = 0; index <= REMEMBERED_VERDICTS; index += 1) {
      known = remember(known, `senha número ${index}`, "accepted");
    }

    expect(known.size).toBe(REMEMBERED_VERDICTS);
    expect(known.has("senha número 0")).toBe(false);
    expect(known.has(`senha número ${REMEMBERED_VERDICTS}`)).toBe(true);
  });

  it("refreshes a password asked about again", () => {
    const known = remember(remember(new Map(), "a", "accepted"), "b", "accepted");
    expect([...remember(known, "a", "breached").keys()]).toEqual(["b", "a"]);
  });
});
