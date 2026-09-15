import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Supabase adapter against a stand-in for the SDK: what it asks the
 * service for, and what it refuses to do. The one rule with teeth is the
 * private bucket — the property every signed URL in this application rests on,
 * and one that lives in a dashboard checkbox.
 */

const service = vi.hoisted(() => ({
  public: false,
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
        return { data: { id: name, name, public: service.public }, error: null };
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
});
