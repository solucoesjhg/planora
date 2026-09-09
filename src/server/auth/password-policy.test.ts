import { describe, expect, it } from "vitest";
import { isRefused } from "@/lib/result";
import {
  MIN_PASSWORD_LENGTH,
  checkPassword,
  checkPasswordShape,
  isBreached,
} from "./password-policy";

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const reason = (password: string, identity = {}) => {
  const decision = checkPasswordShape(password, identity);
  return isRefused(decision) ? decision.reason : "allowed";
};

describe("length", () => {
  it(`refuses anything under ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(reason("sete123")).toBe("too-short");
    expect(reason("oito1234")).toBe("allowed");
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

describe("the breach check", () => {
  const response = (body: string, ok = true) =>
    ({ ok, text: async () => body }) as Response;

  it("finds the password when its hash suffix is in the range", async () => {
    // SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    const found = await isBreached("password", {
      fetch: async () => response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:9999"),
    });

    expect(found).toBe(true);
  });

  it("clears a password whose suffix is absent", async () => {
    const found = await isBreached("uma frase que ninguem usou", {
      fetch: async () => response("0000000000000000000000000000000000A:3"),
    });

    expect(found).toBe(false);
  });

  it("fails open when the service is down, rather than blocking signup", async () => {
    expect(
      await isBreached("password", {
        fetch: async () => {
          throw new Error("network is down");
        },
      }),
    ).toBe(false);

    expect(
      await isBreached("password", { fetch: async () => response("", false) }),
    ).toBe(false);
  });
});

describe("checkPassword", () => {
  it("stops at the shape rules before spending a request", async () => {
    const decision = await checkPassword("senha123", {}, {
      fetch: async () => {
        throw new Error("must not be called");
      },
    });

    expect(isRefused(decision) && decision.reason).toBe("too-common");
  });

  it("refuses a breached password that passes every other rule", async () => {
    // A passphrase the shape rules are happy with, answered by a range that
    // contains its own hash suffix.
    const passphrase = "trilha molhada de barro";
    const suffix = (await sha1Hex(passphrase)).toUpperCase().slice(5);

    const decision = await checkPassword(
      passphrase,
      {},
      {
        fetch: async () =>
          ({ ok: true, text: async () => `${suffix}:42` }) as Response,
      },
    );

    expect(isRefused(decision) && decision.reason).toBe("breached");
  });

  it("lets an unbreached passphrase through", async () => {
    const decision = await checkPassword(
      "trilha molhada de barro",
      {},
      {
        fetch: async () =>
          ({ ok: true, text: async () => "ABCDEF0123456789ABCDEF0123456789ABC:1" }) as Response,
      },
    );

    expect(isRefused(decision)).toBe(false);
  });
});
