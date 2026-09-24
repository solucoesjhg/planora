import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Supabase adapter against a stand-in for the SDK: what it asks the
 * service for, and what it refuses to do. The one rule with teeth is the
 * private bucket — the property every signed URL in this application rests on,
 * and one that lives in a dashboard checkbox.
 */

const service = vi.hoisted(() => ({
  public: false,
  fileSizeLimit: 25 * 1024 * 1024 as number | undefined,
  allowedMimeTypes: ["image/png", "application/pdf"] as string[] | undefined,
  describedTimes: 0,
  urls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string) => ({
    ...(service.urls.push(url) && {}),
    storage: {
      getBucket: async (name: string) => {
        service.describedTimes += 1;
        return {
          data: {
            id: name,
            name,
            public: service.public,
            file_size_limit: service.fileSizeLimit,
            allowed_mime_types: service.allowedMimeTypes,
          },
          error: null,
        };
      },
      from: (name: string) => ({
        createSignedUploadUrl: async (path: string) => ({
          data: {
            signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/${name}/${path}?token=t`,
            token: "t",
            path,
          },
          error: null,
        }),
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/${name}/${path}?token=r` },
          error: null,
        }),
      }),
    },
  }),
}));

import { projectOrigin, supabaseStorageAdapter } from "./supabase";

describe("supabaseStorageAdapter", () => {
  beforeEach(() => {
    service.public = false;
    service.fileSizeLimit = 25 * 1024 * 1024;
    service.allowedMimeTypes = ["image/png", "application/pdf"];
    service.describedTimes = 0;
    service.urls = [];
  });

  /**
   * What the first deploy had in `SUPABASE_URL`: the Data API URL, which the
   * dashboard shows beside the project URL. Every storage request then reached
   * PostgREST, and the log said "Invalid path specified in request URL".
   */
  it("refuses a project URL that carries a path, naming the variable", async () => {
    const storage = supabaseStorageAdapter("https://x.supabase.co/rest/v1", "k");

    await expect(storage.upload("ws/p/a/planta.pdf", "application/pdf")).rejects.toThrow(
      /SUPABASE_URL must be the project URL alone — https:\/\/x\.supabase\.co/,
    );
    await expect(storage.upload("ws/p/a/planta.pdf", "application/pdf")).rejects.toThrow(
      /Invalid path specified in request URL/,
    );
    // The SDK was never even built.
    expect(service.urls).toEqual([]);
  });

  it("accepts the project URL with or without a trailing slash, and hands the SDK the origin", async () => {
    expect(projectOrigin("https://x.supabase.co/")).toBe("https://x.supabase.co");
    expect(projectOrigin("https://x.supabase.co")).toBe("https://x.supabase.co");
    expect(() => projectOrigin("x.supabase.co")).toThrow(/not a URL/);
    expect(() => projectOrigin("https://x.supabase.co/storage/v1")).toThrow(/wrong service/);

    const storage = supabaseStorageAdapter("https://x.supabase.co/", "k");
    await storage.upload("ws/p/a/planta.pdf", "application/pdf");
    expect(service.urls).toEqual(["https://x.supabase.co"]);
  });

  it("refuses a ticket and a link while the bucket is public", async () => {
    service.public = true;
    const storage = supabaseStorageAdapter("https://x.supabase.co", "service-role");

    await expect(storage.upload("ws/p/a/planta.pdf", "application/pdf")).rejects.toThrow(
      /must be private/,
    );
    await expect(storage.signedUrl("ws/p/a/planta.pdf", 60)).rejects.toThrow(
      /must be private/,
    );
  });

  it("asks once per process while the answer is the right one", async () => {
    const storage = supabaseStorageAdapter("https://x.supabase.co", "service-role");

    const ticket = await storage.upload("ws/p/a/planta.pdf", "application/pdf");
    expect(ticket.url).toContain("/object/upload/sign/attachments/ws/p/a/planta.pdf");
    expect(ticket.method).toBe("PUT");

    await storage.upload("ws/p/b/foto.png", "image/png");
    expect(await storage.signedUrl("ws/p/a/planta.pdf", 60)).toContain("/object/sign/");
    expect(service.describedTimes).toBe(1);
  });

  it("asks again after a refusal, so flipping the checkbox back needs no redeploy", async () => {
    service.public = true;
    const storage = supabaseStorageAdapter("https://x.supabase.co", "service-role");

    await expect(storage.upload("ws/p/a/planta.pdf", "application/pdf")).rejects.toThrow();

    service.public = false;
    await expect(storage.upload("ws/p/a/planta.pdf", "application/pdf")).resolves.toMatchObject({
      method: "PUT",
    });
    expect(service.describedTimes).toBe(2);
  });

  /**
   * The browser uploads straight to the bucket, so the bucket is the only
   * thing between a ticket and whatever arrives on it (ADR 0006). One left at
   * Supabase's defaults took an SVG on a ticket asked for as a PNG.
   */
  it("refuses a ticket while the bucket takes any type or any size, and still signs links", async () => {
    service.allowedMimeTypes = undefined;
    service.fileSizeLimit = undefined;
    const storage = supabaseStorageAdapter("https://x.supabase.co", "service-role");

    await expect(storage.upload("ws/p/a/planta.pdf", "application/pdf")).rejects.toThrow(
      /accepts more than the application keeps \(no-size-limit, any-type-accepted\)/,
    );
    // A file already kept is still readable while the bucket is being fixed.
    await expect(storage.signedUrl("ws/p/a/planta.pdf", 60)).resolves.toContain("/object/sign/");
  });

  it("refuses a bucket looser than the application, and asks again once it is fixed", async () => {
    service.allowedMimeTypes = ["image/png", "image/svg+xml"];
    service.fileSizeLimit = 50 * 1024 * 1024;
    const storage = supabaseStorageAdapter("https://x.supabase.co", "service-role");

    await expect(storage.upload("ws/p/a/foto.png", "image/png")).rejects.toThrow(
      /size-limit-above-ours, type-outside-ours/,
    );

    service.allowedMimeTypes = ["image/png"];
    service.fileSizeLimit = 10 * 1024 * 1024;
    await expect(storage.upload("ws/p/a/foto.png", "image/png")).resolves.toMatchObject({
      method: "PUT",
    });
  });
});
