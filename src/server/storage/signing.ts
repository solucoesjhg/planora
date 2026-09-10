/**
 * Signatures for the filesystem adapter's URLs.
 *
 * Development has no Supabase to issue signed URLs, so this application issues
 * its own: an HMAC over the intent, the path and the expiry, checked by the
 * route that serves the bytes. The point of a signed URL survives — it stops
 * working on its own, and it cannot be edited into a URL for someone else's
 * file — without a second service running on the machine.
 */

const encoder = new TextEncoder();

export type SignedIntent = "read" | "upload";

export type SignedLink = {
  readonly expires: number;
  readonly signature: string;
};

export async function signPath(
  intent: SignedIntent,
  path: string,
  seconds: number,
  secret: string,
): Promise<SignedLink> {
  const expires = Math.floor(Date.now() / 1000) + seconds;
  return { expires, signature: await sign(`${intent}:${path}:${expires}`, secret) };
}

/** Whether this signature was issued here, for this path, and is still valid. */
export async function verifyPath(
  intent: SignedIntent,
  path: string,
  link: SignedLink,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  if (!Number.isFinite(link.expires)) return false;
  if (link.expires * 1000 <= now.getTime()) return false;

  const expected = await sign(`${intent}:${path}:${link.expires}`, secret);
  return timingSafeEqual(expected, link.signature);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  let out = "";
  for (const byte of new Uint8Array(signature)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Comparison that does not leak where two signatures start to differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
