import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { signPath, verifyPath, type SignedIntent } from "./signing";
import type { Storage, StoredMetadata, UploadTicket } from "./storage";

/**
 * Development storage: the bytes sit under `.storage/`, and the signed URLs
 * point at this application's own `/api/files` route (see `signing.ts`). The
 * shape the rest of the code sees is the one Supabase Storage gives it.
 */

const ROOT = process.env["STORAGE_DIR"] ?? join(process.cwd(), ".storage");

/**
 * Every call below reads a path built at runtime, which makes the bundler trace
 * the whole project into the output "just in case". These paths are scoped to
 * `ROOT` by `resolve()`, and this adapter never runs in production — `getStorage`
 * refuses to build it there — so the tracer is told to leave them alone.
 */

export function localStorageAdapter(
  secret: string,
  bucket = "attachments",
  baseUrl = process.env["BETTER_AUTH_URL"] ?? "",
): Storage {
  return {
    name: "local",
    bucket,

    async upload(path, mime): Promise<UploadTicket> {
      const link = await signPath("upload", path, 15 * 60, secret);
      return {
        url: linkUrl(baseUrl, path, link.expires, link.signature),
        method: "PUT",
        headers: { "content-type": mime },
        expiresAt: new Date(link.expires * 1000),
      };
    },

    async head(path): Promise<StoredMetadata | null> {
      const file = resolve(path);
      if (!file) return null;

      try {
        const [info, bytes] = await Promise.all([
          stat(/*turbopackIgnore: true*/ file),
          readFile(/*turbopackIgnore: true*/ file),
        ]);
        return {
          size: info.size,
          mime: await readMime(file),
          checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        };
      } catch {
        return null;
      }
    },

    async signedUrl(path, seconds) {
      const link = await signPath("read", path, seconds, secret);
      return linkUrl(baseUrl, path, link.expires, link.signature);
    },

    async remove(path) {
      const file = resolve(path);
      if (!file) return;
      await rm(/*turbopackIgnore: true*/ file, { force: true });
      await rm(/*turbopackIgnore: true*/ `${file}.mime`, { force: true });
    },
  };
}

/* ------------------------------------------------------------------ *
 * What the route handler needs
 * ------------------------------------------------------------------ */

export async function verifyLocalLink(
  intent: SignedIntent,
  path: string,
  expires: number,
  signature: string,
  secret: string,
): Promise<boolean> {
  return verifyPath(intent, path, { expires, signature }, secret);
}

export async function writeLocalObject(
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  const file = resolve(path);
  if (!file) throw new Error("refusing to write outside the storage directory");

  await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ file, bytes);
  await writeFile(/*turbopackIgnore: true*/ `${file}.mime`, mime, "utf8");
}

export async function readLocalObject(
  path: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const file = resolve(path);
  if (!file) return null;

  try {
    return {
      bytes: await readFile(/*turbopackIgnore: true*/ file),
      mime: await readMime(file),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

/**
 * `null` for anything that would climb out of the storage directory. The path
 * arrives from a signed URL, but a signature only proves the string was issued
 * here — not that it is safe to join onto a filesystem root.
 */
function resolve(path: string): string | null {
  const cleaned = normalize(path).replaceAll("\\", "/");
  if (cleaned.startsWith("../") || cleaned.startsWith("/") || cleaned.includes("..")) {
    return null;
  }

  const file = join(/*turbopackIgnore: true*/ ROOT, cleaned);
  return file.startsWith(ROOT + sep) ? file : null;
}

async function readMime(file: string): Promise<string> {
  try {
    return (await readFile(/*turbopackIgnore: true*/ `${file}.mime`, "utf8")).trim();
  } catch {
    return "application/octet-stream";
  }
}

function linkUrl(
  baseUrl: string,
  path: string,
  expires: number,
  signature: string,
): string {
  const query = `exp=${expires}&sig=${signature}`;
  const relative = `/api/files/${path.split("/").map(encodeURIComponent).join("/")}?${query}`;
  return baseUrl ? new URL(relative, baseUrl).toString() : relative;
}
