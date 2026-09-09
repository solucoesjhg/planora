/**
 * UUID v7 (DEVELOPMENT_PLAN.md §4.1).
 *
 * Unique like a UUID, time-ordered like a sequence, so inserts stay local in
 * the index instead of scattering. Generated here rather than by the database:
 * the Postgres version on a managed host is not ours to depend on.
 */

const HEX = "0123456789abcdef";

export function newId(at: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit big-endian millisecond timestamp.
  let timestamp = BigInt(at);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant

  return format(bytes);
}

/** A deterministic id for fixtures and seeds: same input, same uuid. */
export function fixedId(namespace: string, index: number): string {
  const bytes = new Uint8Array(16);
  let hash = 2166136261;
  for (const character of `${namespace}:${index}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }

  for (let position = 0; position < 16; position += 1) {
    hash = Math.imul(hash ^ (position + 1), 16777619) >>> 0;
    bytes[position] = (hash >>> 24) & 0xff;
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return format(bytes);
}

function format(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < 16; index += 1) {
    const byte = bytes[index] ?? 0;
    out += HEX[byte >> 4] ?? "0";
    out += HEX[byte & 0x0f] ?? "0";
    if (index === 3 || index === 5 || index === 7 || index === 9) out += "-";
  }
  return out;
}
