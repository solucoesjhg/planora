/**
 * Password policy.
 *
 * The rules here follow NIST SP 800-63B and OWASP ASVS, which both changed
 * direction after two decades of evidence: **length and a blocklist beat
 * composition rules**. Requiring an uppercase, a digit and a symbol does not
 * produce `k7$Vm2!qLx` — it produces `Senha@123`, `Planora2026!`, `Brasil@1`,
 * because that is what a person invents under pressure and remembers. Those
 * three are in every breach corpus, and they satisfy every composition rule
 * ever written.
 *
 * So what is enforced is: a floor on length, a blocklist of what people
 * actually choose, no reuse of the person's own name or address, and a
 * best-effort check against the breach corpus.
 */

import { type Decision, allowed, refused } from "@/lib/result";

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordRefusal =
  | "too-short"
  | "too-common"
  | "contains-identity"
  | "breached";

export type Identity = {
  readonly email?: string | undefined;
  readonly name?: string | undefined;
};

/**
 * The passwords people in Brazil actually pick, plus the global classics and
 * the ones this product invites (`planora`, `kanban`). Compared after
 * lowercasing and stripping accents, so `Senha` and `senhá` are the same word.
 */
const BLOCKLIST = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "senha123",
  "senha1234",
  "senhasenha",
  "minhasenha",
  "password",
  "password1",
  "password123",
  "qwertyui",
  "qwerty123",
  "asdfghjk",
  "abcd1234",
  "abc12345",
  "a1b2c3d4",
  "11111111",
  "00000000",
  "brasil123",
  "brasil2026",
  "saopaulo",
  "flamengo",
  "corinthians",
  "palmeiras",
  "gremio123",
  "familia123",
  "amoreterno",
  "teamo123",
  "deusefiel",
  "jesuscristo",
  "administrador",
  "administrator",
  "planora123",
  "planora2026",
  "kanban123",
  "projeto123",
  "trabalho123",
  "iloveyou",
  "letmein123",
  "welcome123",
  "changeme",
  "trocar123",
]);

/**
 * The deterministic half: no network, no clock, no database. Every case here
 * is a test in `password-policy.test.ts`.
 */
export function checkPasswordShape(
  password: string,
  identity: Identity = {},
): Decision<PasswordRefusal> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return refused("too-short", `${password.length}`);
  }

  const normalized = normalize(password);

  if (BLOCKLIST.has(normalized)) return refused("too-common", "blocklist");
  if (isSingleRepeatedCharacter(normalized)) return refused("too-common", "repeat");
  if (isRunOfNeighbours(normalized)) return refused("too-common", "sequence");

  for (const part of identityParts(identity)) {
    if (part.length >= 4 && normalized.includes(part)) {
      return refused("contains-identity", part);
    }
  }

  return allowed;
}

/**
 * The breach corpus, through k-anonymity: only the first five characters of
 * the SHA-1 hash ever leave this process, and the answer comes back as a list
 * of suffixes to search locally. The password itself is never sent.
 *
 * **Fails open on purpose.** An outage at the other end must not take signup
 * with it: the shape rules above have already run, and a best-effort check that
 * blocks the door when it cannot answer is worse than no check.
 */
export async function isBreached(
  password: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);

  try {
    const hash = (await sha1Hex(password)).toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await doFetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
      },
    );
    if (!response.ok) return false;

    const body = await response.text();
    return body
      .split("\n")
      .some((line) => line.split(":")[0]?.trim().toUpperCase() === suffix);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPassword(
  password: string,
  identity: Identity = {},
  options: { checkBreaches?: boolean; fetch?: typeof fetch } = {},
): Promise<Decision<PasswordRefusal>> {
  const shape = checkPasswordShape(password, identity);
  if (shape.kind === "refused") return shape;

  if (options.checkBreaches === false) return allowed;
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  return (await isBreached(password, fetchOption))
    ? refused("breached", "hibp")
    : allowed;
}

/** What the person reads. pt-BR, because this reaches the screen. */
export const PASSWORD_MESSAGES: Record<PasswordRefusal, string> = {
  "too-short": `Use ao menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  "too-common": "Esta senha é uma das mais usadas do mundo. Escolha outra.",
  "contains-identity": "Evite usar seu nome ou e-mail dentro da senha.",
  breached:
    "Esta senha apareceu em vazamentos públicos. Escolha uma que você nunca usou.",
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function identityParts({ email, name }: Identity): string[] {
  const parts: string[] = [];

  const local = email?.split("@")[0];
  if (local) parts.push(normalize(local));

  for (const word of name?.split(/\s+/) ?? []) {
    if (word) parts.push(normalize(word));
  }

  return parts;
}

function isSingleRepeatedCharacter(value: string): boolean {
  return new Set(value).size === 1;
}

/** `12345678`, `abcdefgh`, and the same walked backwards. */
function isRunOfNeighbours(value: string): boolean {
  let ascending = true;
  let descending = true;

  for (let index = 1; index < value.length; index += 1) {
    const step = value.charCodeAt(index) - value.charCodeAt(index - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }

  return ascending || descending;
}

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value),
  );

  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
