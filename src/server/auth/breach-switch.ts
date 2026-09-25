/**
 * The switch that turns the breach lookup off (ADR 0008).
 *
 * The E2E suite sets `DISABLE_BREACH_CHECK=1` so it never reaches a third
 * party. A production deployment that inherited it would accept the most
 * leaked passwords there are, so production refuses it twice: the build fails
 * (`next.config.ts`), which leaves the previous deployment serving, and a
 * server that somehow starts with it anyway keeps checking.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const isProduction = (env: Environment) => env["VERCEL_ENV"] === "production";
const isSwitchedOff = (env: Environment) => env["DISABLE_BREACH_CHECK"] === "1";

/** For the build: fails it when production is asked to skip the lookup. */
export function assertBreachSwitchAllowed(env: Environment = process.env): void {
  if (isSwitchedOff(env) && isProduction(env)) {
    throw new Error(
      "DISABLE_BREACH_CHECK=1 must not be set for production: remove it from the production environment in Vercel.",
    );
  }
}

/** For the server: whether passwords are checked against the breach corpus. */
export function breachChecksOn(env: Environment = process.env): boolean {
  return !isSwitchedOff(env) || isProduction(env);
}
