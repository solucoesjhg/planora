import { describe, expect, it } from "vitest";
import { signPath, verifyPath } from "./signing";

const SECRET = "planora-test-secret-planora-test-secret-32";

describe("signed file links", () => {
  const path = "workspace/project/attachment/planta.pdf";

  it("accepts the link it just issued", async () => {
    const link = await signPath("read", path, 60, SECRET);
    expect(await verifyPath("read", path, link, SECRET)).toBe(true);
  });

  it("refuses it once it has expired", async () => {
    const link = await signPath("read", path, 60, SECRET);
    const later = new Date(Date.now() + 61_000);

    expect(await verifyPath("read", path, link, SECRET, later)).toBe(false);
  });

  it("refuses a link edited to point somewhere else", async () => {
    const link = await signPath("read", path, 60, SECRET);
    const elsewhere = "workspace/project/attachment/../../outra/planta.pdf";

    expect(await verifyPath("read", elsewhere, link, SECRET)).toBe(false);
  });

  it("refuses a link whose expiry was pushed forward", async () => {
    const link = await signPath("read", path, 60, SECRET);
    const stretched = { ...link, expires: link.expires + 86_400 };

    expect(await verifyPath("read", path, stretched, SECRET)).toBe(false);
  });

  it("does not let a link for reading be used for writing", async () => {
    const link = await signPath("read", path, 60, SECRET);
    expect(await verifyPath("upload", path, link, SECRET)).toBe(false);
  });

  it("refuses a link signed with another secret", async () => {
    const link = await signPath("read", path, 60, "a-different-secret-entirely-32ch");
    expect(await verifyPath("read", path, link, SECRET)).toBe(false);
  });

  it("refuses nonsense in place of an expiry", async () => {
    expect(
      await verifyPath("read", path, { expires: Number.NaN, signature: "x" }, SECRET),
    ).toBe(false);
  });

  /**
   * An upload ticket asked for as a PNG, replayed with `text/html` after it was
   * confirmed, was stored and served as HTML from this origin (ADR 0006).
   */
  it("binds an upload to the type it was asked for", async () => {
    const link = await signPath("upload", path, 60, SECRET, "image/png");

    expect(await verifyPath("upload", path, link, SECRET, new Date(), "image/png")).toBe(true);
    expect(await verifyPath("upload", path, link, SECRET, new Date(), "text/html")).toBe(false);
    expect(await verifyPath("upload", path, link, SECRET)).toBe(false);
  });
});
