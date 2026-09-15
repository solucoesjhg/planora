import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Storage, StoredMetadata, UploadTicket } from "./storage";

/**
 * Production storage — and the only place in this codebase where the Supabase
 * SDK appears (§5.1). The bucket is private: nothing is readable without a URL
 * this application signed, and it signs one only after the workspace check.
 */
export function supabaseStorageAdapter(
  url: string,
  serviceRoleKey: string,
  bucket = "attachments",
): Storage {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const files = () => client.storage.from(bucket);

  /**
   * The private bucket is the property this adapter exists for: nothing is
   * readable without a URL this application signed, after the workspace
   * check. That property lives in a checkbox on Supabase's dashboard, and a
   * checkbox gets flipped by whoever is trying to make an upload work. So the
   * bucket is asked, once per process, before the first ticket or link — and
   * asked again after a refusal, so flipping it back needs no redeploy.
   */
  let known: Promise<void> | null = null;
  const ensurePrivate = (): Promise<void> => {
    known ??= describeBucket().catch((error: unknown) => {
      known = null;
      throw error;
    });
    return known;
  };
  async function describeBucket(): Promise<void> {
    const { data, error } = await client.storage.getBucket(bucket);
    if (error || !data) {
      throw new Error(`storage could not describe bucket "${bucket}": ${error?.message}`);
    }
    if (data.public) {
      throw new Error(
        `bucket "${bucket}" is public; it must be private — every file in it can be ` +
          "read by anyone with its path, for as long as it exists. Supabase → " +
          "Storage → the bucket → Edit → Public bucket off (docs/DEPLOY.md, 1.2).",
      );
    }
  }

  return {
    name: "supabase",
    bucket,

    async upload(path, mime): Promise<UploadTicket> {
      await ensurePrivate();
      const { data, error } = await files().createSignedUploadUrl(path, {
        upsert: false,
      });
      if (error || !data) {
        throw new Error(`storage refused an upload ticket: ${error?.message}`);
      }

      return {
        url: data.signedUrl,
        method: "PUT",
        headers: { "content-type": mime },
        // The SDK does not report the expiry; Supabase issues these for two hours.
        expiresAt: new Date(Date.now() + 2 * 60 * 60_000),
      };
    },

    async head(path): Promise<StoredMetadata | null> {
      const folder = path.split("/").slice(0, -1).join("/");
      const name = path.split("/").at(-1) ?? "";

      const { data, error } = await files().list(folder, { search: name, limit: 1 });
      const object = data?.find((entry) => entry.name === name);
      if (error || !object) return null;

      const metadata = object.metadata as
        | { size?: number; mimetype?: string; eTag?: string }
        | undefined;

      return {
        size: metadata?.size ?? 0,
        mime: metadata?.mimetype ?? "application/octet-stream",
        // Supabase reports the object's ETag, which for a single-part upload is
        // its MD5. It is the store's own word for what it holds.
        checksum: `md5:${(metadata?.eTag ?? "").replaceAll('"', "")}`,
      };
    },

    async signedUrl(path, seconds) {
      await ensurePrivate();
      const { data, error } = await files().createSignedUrl(path, seconds);
      if (error || !data) throw new Error(`storage refused a link: ${error?.message}`);
      return data.signedUrl;
    },

    async remove(path) {
      const { error } = await files().remove([path]);
      if (error) throw new Error(`storage refused a delete: ${error.message}`);
    },
  };
}
