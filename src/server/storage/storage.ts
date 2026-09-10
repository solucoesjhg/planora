/**
 * Attachment storage (DEVELOPMENT_PLAN.md §5.1, §7 Phase 7).
 *
 * Bytes never pass through this application: the browser is handed a URL that
 * is valid for a few minutes and uploads to it directly, then tells the server
 * where to look. Reading works the same way in reverse — a signed URL, issued
 * only after the workspace check, that stops working when it expires.
 *
 * Three adapters behind one port, the way email has three senders: Supabase
 * Storage in production, the filesystem in development, memory in tests. §9.1
 * named this as the fallback if the Supabase CLI stack proved too heavy on this
 * machine; it did, so only this folder knows.
 */

export type UploadTicket = {
  /** Where the browser sends the bytes. */
  readonly url: string;
  readonly method: "PUT" | "POST";
  readonly headers: Record<string, string>;
  readonly expiresAt: Date;
};

/** What the store itself says it is holding — not what the client claimed. */
export type StoredMetadata = {
  readonly size: number;
  readonly mime: string;
  /** Prefixed with the algorithm the store vouches for: `sha256:` or `md5:`. */
  readonly checksum: string;
};

export type Storage = {
  readonly name: string;
  readonly bucket: string;
  upload(path: string, mime: string): Promise<UploadTicket>;
  /** What landed at that path, or `null` if nothing did. */
  head(path: string): Promise<StoredMetadata | null>;
  signedUrl(path: string, seconds: number): Promise<string>;
  remove(path: string): Promise<void>;
};

/** Tests: the bytes stay in the process, and the ticket is never fetched. */
export type MemoryStorage = Storage & {
  /** Stands in for the browser's upload. */
  put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  readonly objects: Map<string, { bytes: Uint8Array; mime: string }>;
};

export function memoryStorage(bucket = "attachments"): MemoryStorage {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();

  return {
    name: "memory",
    bucket,
    objects,

    async put(path, bytes, mime) {
      objects.set(path, { bytes, mime });
    },

    async upload(path, mime) {
      return {
        url: `memory://${bucket}/${path}?mime=${encodeURIComponent(mime)}`,
        method: "PUT",
        headers: { "content-type": mime },
        expiresAt: new Date(Date.now() + 5 * 60_000),
      };
    },

    async head(path) {
      const object = objects.get(path);
      if (!object) return null;
      return {
        size: object.bytes.byteLength,
        mime: object.mime,
        checksum: `sha256:${await sha256(object.bytes)}`,
      };
    },

    async signedUrl(path, seconds) {
      const expires = Math.floor(Date.now() / 1000) + seconds;
      return `memory://${bucket}/${path}?exp=${expires}`;
    },

    async remove(path) {
      objects.delete(path);
    },
  };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source);
  let out = "";
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
  return out;
}
