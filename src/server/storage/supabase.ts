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

  return {
    name: "supabase",
    bucket,

    async upload(path, mime): Promise<UploadTicket> {
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
