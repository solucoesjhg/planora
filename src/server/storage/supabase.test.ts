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
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
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

import { supabaseStorageAdapter } from "./supabase";

describe("supabaseStorageAdapter", () => {
  beforeEach(() => {
    service.public = false;
    service.describedTimes = 0;
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
