/**
 * What a password may be (ADR 0008).
 *
 * The rules follow NIST SP 800-63B and OWASP ASVS, which both changed direction
 * after two decades of evidence: **length and a blocklist beat composition
 * rules**. Requiring an uppercase, a digit and a symbol does not produce
 * `k7$Vm2!qLx` — it produces `Senha@123`, `Planora2026!`, `Brasil@1`, because
 * that is what a person invents under pressure and remembers. Those three are in
 * every breach corpus, and they satisfy every composition rule ever written.
 *
 * So what is enforced is: a floor and a ceiling on length, a blocklist of what
 * people actually choose, no reuse of the person's own name or address, and —
 * where the server can ask — a refusal of the passwords that breach dumps show
 * many people converged on.
 *
 * One rule, two consumers: the sign-up form runs the shape rules on every
 * keystroke, and the server runs the same function before it stores anything.
 */

import { type Decision, allowed, refused } from "@/lib/result";

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Better Auth's own ceiling, stated here so the form and the policy refuse it
 * before the endpoint does — past the policy, a refusal would already have
 * spent the sign-up allowance.
 */
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordRefusal =
  | "too-short"
  | "too-long"
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
 * The deterministic half: no network, no clock, no database. It runs in the
 * browser as the person types and on the server before a password is stored.
 */
export function checkPasswordShape(
  password: string,
  identity: Identity = {},
): Decision<PasswordRefusal> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return refused("too-short", `${password.length}`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return refused("too-long", `${password.length}`);
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
 * How many times a password may appear in the breach corpus and still be
 * accepted: nine.
 *
 * What a policy can defend at sign-up is online guessing — an attacker trying
 * the most popular passwords, in order of popularity, across many accounts.
 * Ten appearances means at least ten accounts in the dumps converged on the
 * string; it is no longer a personal choice, and it sits in the frequency-sorted
 * wordlists built from those dumps. One to nine is the long tail: strings one
 * person, or a few, ever used. Refusing those is what made almost every
 * password fail, and it buys little against guessing.
 */
export const BREACH_REFUSAL_THRESHOLD = 10;

/** Whether a password seen `count` times in the breach corpus is refused. */
export function judgeBreachCount(count: number): Decision<"breached"> {
  return count >= BREACH_REFUSAL_THRESHOLD ? refused("breached", `${count}`) : allowed;
}

/**
 * What the live check answers: a refusal, acceptance, or that the breach
 * corpus could not be asked — in which case the server decides at submit, and
 * it fails open there as it always has.
 */
export type PasswordVerdict = "accepted" | PasswordRefusal | "unavailable";

const VERDICTS: readonly PasswordVerdict[] = [
  "accepted",
  "too-short",
  "too-long",
  "too-common",
  "contains-identity",
  "breached",
  "unavailable",
];

export function isPasswordVerdict(value: unknown): value is PasswordVerdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

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
