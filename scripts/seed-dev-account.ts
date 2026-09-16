/**
 * A standing account for the developer's own machine.
 *
 * Sign-up through the form is the right path for a person; it is the wrong
 * path for a fixture, because the password policy refuses anything that
 * contains the address's own local part, and because every database reset
 * would mean the inbox dance again. This writes the account directly, with the
 * same hash Better Auth would have written, marks the address verified, and
 * gives it the personal workspace and example project a sign-up would.
 *
 * Idempotent: re-running updates the password and leaves everything else.
 *
 * It refuses to run against anything that is not a local database, so a
 * mis-set DATABASE_URL cannot plant a known password in a real deployment.
 *
 *   pnpm db:seed:dev
 */

import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { fixedId } from "@/lib/id";
import { createDatabase } from "@/server/db/client";
import { accounts, users } from "@/server/db/schema";
import { ensurePersonalWorkspace } from "@/server/modules/workspaces/repository";

const ACCOUNT = {
  id: fixedId("dev-account", 1),
  email: "planoradev@teste.com",
  name: "Planora Dev",
  password: "planoradev",
} as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function localDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run with --env-file=.env.local.");

  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}. This seed only runs against a local database.`,
    );
  }
  return url;
}

async function main(): Promise<void> {
  const { db, close } = createDatabase(localDatabaseUrl(), 1);

  try {
    const hash = await hashPassword(ACCOUNT.password);

    await db
      .insert(users)
      .values({
        id: ACCOUNT.id,
        email: ACCOUNT.email,
        name: ACCOUNT.name,
        emailVerified: true,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: ACCOUNT.name, emailVerified: true },
      });

    // The row may predate this script with another id; read it back.
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ACCOUNT.email));
    if (!user) throw new Error("the user row did not come back");

    // Better Auth's credential account: accountId is the user id, and the
    // password column holds its own hash format.
    await db
      .insert(accounts)
      .values({
        id: fixedId("dev-account-credential", 1),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hash,
      })
      .onConflictDoUpdate({
        target: [accounts.providerId, accounts.accountId],
        set: { password: hash, updatedAt: new Date() },
      });

    const workspaceId = await ensurePersonalWorkspace(db, {
      id: user.id,
      name: ACCOUNT.name,
      email: ACCOUNT.email,
    });

    // Prove the stored hash accepts the password, the same way sign-in will.
    const [stored] = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    const accepts =
      stored?.password !== null &&
      stored?.password !== undefined &&
      (await verifyPassword({ hash: stored.password, password: ACCOUNT.password }));
    if (!accepts) throw new Error("the stored hash does not accept the password");

    console.log(`[seed] ${ACCOUNT.email} is ready.`);
    console.log(`[seed] user ${user.id}, workspace ${workspaceId}, address verified.`);
    console.log(`[seed] sign in at ${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`[seed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
