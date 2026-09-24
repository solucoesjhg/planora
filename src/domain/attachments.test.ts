import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  bucketProblems,
  isAllowedType,
  landedAsDeclared,
  mediaType,
} from "./attachments";

describe("an attachment's type", () => {
  it("reads a Content-Type as the media type it names", () => {
    expect(mediaType("Text/Plain; charset=UTF-8")).toBe("text/plain");
    expect(mediaType(" image/PNG ")).toBe("image/png");
    expect(mediaType("")).toBe("");
  });

  it("refuses the types that are documents, not files", () => {
    for (const type of ["image/svg+xml", "text/html", "application/xhtml+xml", "text/xml"]) {
      expect(isAllowedType(type)).toBe(false);
    }
    expect(isAllowedType("application/pdf")).toBe(true);
  });

  /**
   * The audit of 2026-09-24 (ADR 0006): a ticket asked for as `image/png`
   * received an SVG, and the store served it inline from its own origin.
   */
  it("keeps what landed only when it is what was declared", () => {
    expect(landedAsDeclared("image/png", "image/png")).toBe(true);
    expect(landedAsDeclared("text/csv", "text/csv;charset=utf-8")).toBe(true);
    expect(landedAsDeclared("image/png", "image/svg+xml")).toBe(false);
    // On the list, and still not what was asked for.
    expect(landedAsDeclared("image/png", "application/pdf")).toBe(false);
  });
});

describe("a bucket for attachments", () => {
  const strict = {
    public: false,
    fileSizeLimit: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  };

  it("has nothing wrong with it when it enforces our list and our size", () => {
    expect(bucketProblems(strict)).toEqual([]);
    // Stricter is fine.
    expect(
      bucketProblems({ ...strict, fileSizeLimit: 1024, allowedMimeTypes: ["image/png"] }),
    ).toEqual([]);
  });

  it("names every way it is looser than the application", () => {
    expect(
      bucketProblems({ public: true, fileSizeLimit: null, allowedMimeTypes: null }),
    ).toEqual(["public", "no-size-limit", "any-type-accepted"]);
    expect(
      bucketProblems({
        ...strict,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: ["image/png", "image/svg+xml"],
      }),
    ).toEqual(["size-limit-above-ours", "type-outside-ours"]);
    expect(bucketProblems({ ...strict, allowedMimeTypes: [] })).toEqual(["any-type-accepted"]);
  });
});
