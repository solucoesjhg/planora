import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  securityHeaders,
  storageOriginOf,
  type PolicyEnvironment,
} from "./security-headers";

const deployed: PolicyEnvironment = { development: false, storageOrigin: null };

/** The policy as a directive → sources map, which is how it reads. */
function parse(policy: string): Record<string, string[]> {
  const entries = policy.split("; ").map((directive) => {
    const [name, ...sources] = directive.split(" ");
    return [name ?? "", sources] as const;
  });
  expect(new Set(entries.map(([name]) => name)).size).toBe(entries.length);
  return Object.fromEntries(entries);
}

describe("the content security policy", () => {
  it("closes everything the application does not use", () => {
    const directives = parse(contentSecurityPolicy(deployed));

    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
    expect(directives["frame-src"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["worker-src"]).toEqual(["'none'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
  });

  /**
   * The one directive that is not strict, and the reason the module carries a
   * long comment. If a nonce ever lands in `proxy.ts`, this expectation is the
   * first thing to flip.
   */
  it("allows inline script, because Next renders its flight data inline", () => {
    expect(parse(contentSecurityPolicy(deployed))["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it("never allows evaluation outside next dev", () => {
    expect(contentSecurityPolicy(deployed)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ ...deployed, storageOrigin: "https://x.supabase.co" })).not.toContain(
      "unsafe-eval",
    );
  });

  it("keeps the paper grain, which is a data: URL, loadable", () => {
    expect(parse(contentSecurityPolicy(deployed))["img-src"]).toContain("data:");
  });

  it("names the bucket in the two directives that reach it, and nowhere else", () => {
    const origin = "https://project.supabase.co";
    const directives = parse(
      contentSecurityPolicy({ development: false, storageOrigin: origin }),
    );

    expect(directives["img-src"]).toContain(origin);
    expect(directives["connect-src"]).toContain(origin);
    expect(directives["script-src"]).not.toContain(origin);
    expect(directives["default-src"]).not.toContain(origin);
  });

  it("reaches nothing but this origin when the bytes are on disk", () => {
    expect(parse(contentSecurityPolicy(deployed))["connect-src"]).toEqual(["'self'"]);
  });

  it("gives next dev what next dev needs, and only there", () => {
    const development = parse(
      contentSecurityPolicy({ development: true, storageOrigin: null }),
    );

    expect(development["script-src"]).toContain("'unsafe-eval'");
    expect(development["connect-src"]).toContain("ws:");
    expect(development["worker-src"]).toEqual(["'self'", "blob:"]);
  });
});

describe("the header table", () => {
  it("carries one value per header", () => {
    const keys = securityHeaders(deployed).map((header) => header.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the four headers the first deployment set", () => {
    const table = new Map(
      securityHeaders(deployed).map((header) => [header.key, header.value]),
    );

    expect(table.get("X-Content-Type-Options")).toBe("nosniff");
    expect(table.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(table.get("X-Frame-Options")).toBe("DENY");
    expect(table.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("denies the capabilities the application never asks for", () => {
    const table = new Map(
      securityHeaders(deployed).map((header) => [header.key, header.value]),
    );
    const policy = table.get("Permissions-Policy") ?? "";

    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    // The editor pastes and an attachment may want the screen.
    expect(policy).not.toContain("clipboard");
    expect(policy).not.toContain("fullscreen");
  });

  it("isolates the window and the bytes from other origins", () => {
    const table = new Map(
      securityHeaders(deployed).map((header) => [header.key, header.value]),
    );

    expect(table.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(table.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    // require-corp would block the bucket; nothing here needs isolation.
    expect(table.has("Cross-Origin-Embedder-Policy")).toBe(false);
  });

  it("does not claim HTTPS over next dev's plaintext", () => {
    const keys = securityHeaders({ development: true, storageOrigin: null }).map(
      (header) => header.key,
    );

    expect(keys).not.toContain("Strict-Transport-Security");
    expect(keys).toContain("Content-Security-Policy");
  });
});

describe("the bucket's origin", () => {
  it("is the origin alone, whatever else the variable holds", () => {
    expect(storageOriginOf("https://project.supabase.co")).toBe(
      "https://project.supabase.co",
    );
    // The first deploy had the Data API URL in SUPABASE_URL; a path in it must
    // not become a path in the policy, where it would match nothing.
    expect(storageOriginOf("https://project.supabase.co/rest/v1")).toBe(
      "https://project.supabase.co",
    );
  });

  it("is nothing at all when the variable is missing or not a URL", () => {
    expect(storageOriginOf(undefined)).toBeNull();
    expect(storageOriginOf("")).toBeNull();
    expect(storageOriginOf("project.supabase.co")).toBeNull();
  });
});
