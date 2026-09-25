import { describe, expect, it } from "vitest";
import { isRefused } from "@/lib/result";
import { breachCount, checkPassword } from "./password-policy";

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const response = (body: string, ok = true) =>
  ({ ok, text: async () => body }) as Response;

/** A range answering for `password` with `count`, among other lines. */
async function rangeWith(password: string, count: string, eol = "\r\n"): Promise<string> {
  const suffix = (await sha1Hex(password)).toUpperCase().slice(5);
  return [
    "0000000000000000000000000000000000A:3",
    `${suffix}:${count}`,
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0",
  ].join(eol);
}

describe("the breach count", () => {
  it("reads the count on the line with the password's hash suffix", async () => {
    // SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    const count = await breachCount("password", {
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.pwnedpasswords.com/range/5BAA6");
        return response("1e4c9b93f3f0682250b6cf8331b7ee68fd8:9999");
      },
    });

    expect(count).toBe(9999);
  });

  it("reads the lines the service actually sends, ended by CRLF", async () => {
    const passphrase = "trilha molhada de barro";
    const count = await breachCount(passphrase, {
      fetch: async () => response(await rangeWith(passphrase, "12")),
    });

    expect(count).toBe(12);
  });

  it("is zero when the suffix is absent", async () => {
    const count = await breachCount("uma frase que ninguem usou", {
      fetch: async () => response("0000000000000000000000000000000000A:3"),
    });

    expect(count).toBe(0);
  });

  /**
   * `Add-Padding: true` fills the range with made-up suffixes counted zero. The
   * old check refused any matching line, whatever its count.
   */
  it("reads a padding line as zero", async () => {
    const passphrase = "trilha molhada de barro";
    const count = await breachCount(passphrase, {
      fetch: async () => response(await rangeWith(passphrase, "0")),
    });

    expect(count).toBe(0);
  });

  it("cannot be talked into a refusal by an answer it does not understand", async () => {
    const passphrase = "trilha molhada de barro";

    for (const garbage of ["", "-3", "1e9", "12abc", "99999999999999999999"]) {
      const count = await breachCount(passphrase, {
        fetch: async () => response(await rangeWith(passphrase, garbage)),
      });
      expect(count, `count ${JSON.stringify(garbage)}`).toBeNull();
    }
  });

  it("is unknown when the service is down, rather than a refusal", async () => {
    expect(
      await breachCount("password", {
        fetch: async () => {
          throw new Error("network is down");
        },
      }),
    ).toBeNull();

    expect(await breachCount("password", { fetch: async () => response("", false) })).toBeNull();
  });

  it("asks for padding and refuses to follow a redirect elsewhere", async () => {
    let init: RequestInit | undefined;
    await breachCount("password", {
      fetch: async (_url, options) => {
        init = options;
        return response("");
      },
    });

    expect(new Headers(init?.headers).get("add-padding")).toBe("true");
    expect(init?.redirect).toBe("error");
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

  it("refuses a password many people have leaked", async () => {
    const passphrase = "trilha molhada de barro";

    const decision = await checkPassword(passphrase, {}, {
      fetch: async () => response(await rangeWith(passphrase, "42")),
    });

    expect(isRefused(decision) && decision.reason).toBe("breached");
  });

  /** ADR 0008: seen a few times is the long tail, not a guessable password. */
  it("accepts a password only a few people have leaked", async () => {
    const passphrase = "trilha molhada de barro";

    const decision = await checkPassword(passphrase, {}, {
      fetch: async () => response(await rangeWith(passphrase, "9")),
    });

    expect(isRefused(decision)).toBe(false);
  });

  it("accepts when the corpus cannot be asked", async () => {
    const decision = await checkPassword("trilha molhada de barro", {}, {
      fetch: async () => response("", false),
    });

    expect(isRefused(decision)).toBe(false);
  });

  it("skips the lookup when breach checks are off", async () => {
    const decision = await checkPassword("trilha molhada de barro", {}, {
      checkBreaches: false,
      fetch: async () => {
        throw new Error("must not be called");
      },
    });

    expect(isRefused(decision)).toBe(false);
  });
});
