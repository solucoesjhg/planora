import "server-only";

import { authSecret } from "@/server/auth/secret";
import { localStorageAdapter } from "./local";
import { supabaseStorageAdapter } from "./supabase";
import type { Storage } from "./storage";

export type { Storage, StoredMetadata, UploadTicket } from "./storage";
export { memoryStorage } from "./storage";

let current: Storage | null = null;

/**
 * The store this process should use.
 *
 * Supabase when it is configured. Otherwise the filesystem — which development
 * gets by default, and which anything else has to ask for by name with
 * `STORAGE_DRIVER=local`. A production deployment that merely *forgot* its
 * Supabase credentials must not quietly start writing to a directory on an
 * instance that will be gone in a minute.
 */
export function getStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  if (current) return current;

  const bucket = env["SUPABASE_STORAGE_BUCKET"] ?? "attachments";
  const url = env["SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];

  if (url && key) {
    current = supabaseStorageAdapter(url, key, bucket);
    return current;
  }

  const deliberate = env["STORAGE_DRIVER"] === "local";
  if (env["NODE_ENV"] === "production" && !deliberate) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. " +
        "To run a production build against the filesystem anyway — a local " +
        "smoke test, the E2E suite — set STORAGE_DRIVER=local.",
    );
  }

  // The same secret Better Auth signs with, including its development fallback.
  current = localStorageAdapter(authSecret(env), bucket);
  return current;
}
