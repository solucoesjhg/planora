/**
 * Single-use tokens that travel by email.
 *
 * The token goes to the person; only its hash is stored. A leaked copy of the
 * table is then a list of hashes, not a pile of live invitations.
 */

export function randomToken(bytes = 24): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toHex(buffer);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
