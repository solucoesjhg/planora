import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { newId } from "@/lib/id";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import { hashToken } from "@/lib/token";
import {
  clients,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { acceptInvitation } from "@/server/modules/workspaces/service";
import {
  APP_ROLE,
  connectAndMigrate,
  connectAsApp,
  hasDatabase,
} from "@/server/test-support/database";
import { scopedTransaction, type Connection, type Database } from "./client";

/**
 * The barrier (DEVELOPMENT_PLAN.md §7 Phase 10 · ADR 0002).
 *
 * The phase's criterion is that the database refuses a cross-workspace read on
 * its own — so every test here connects as `planora_app`, the role that cannot
 * bypass a policy, and almost none of them goes through a service. The services
 * and their `where workspace_id = …` are the first barrier; what is under test
 * is the second one, with the first deliberately absent. The exception is
 * joining by invitation, which the database performs itself (ADR 0003): there
 * the service is the only door, so it is the door the test walks through.
 *
 * The rest of the suite connects as the owner, which is a superuser and
 * therefore exempt from every policy including the `FORCE` ones. That is why
 * the thirteen other suites needed no change, and it is why the last test here
 * is a negative control: a suite that cannot fail proves nothing.
 */

const suite = describe.skipIf(!hasDatabase);

/** The other workspace. Nobody in the seed belongs to it. */
const OTHER_WORKSPACE = "99999999-9999-4999-8999-999999999999";
const OTHER_USER = "88888888-8888-4888-8888-888888888888";
const OTHER_CLIENT = "77777777-7777-4777-8777-777777777777";
/** The seed has projects but no clients, and a read has to have something to read. */
const MY_CLIENT = "66666666-6666-4666-8666-666666666666";

const NO_WORKSPACE = "00000000-0000-0000-0000-000000000000";

suite("row-level security, as the application role", () => {
  let owner: Connection;
  let app: Connection;

  const mine = tenantContext(seedIds.workspace, seedIds.user, "owner");

  beforeAll(async () => {
    owner = await connectAndMigrate();
    app = await connectAsApp();
  });

  afterAll(async () => {
    await app.close();
    await owner.close();
  });

  beforeEach(async () => {
    await seed(owner.db);
    await addTwoClients(owner.db);
  });

  /**
   * The phase's own sentence, turned into a test: the tenant check is not
   * merely stubbed out here, it was never called. A bare `select * from
   * clients` is what a repository looks like the day somebody deletes a
   * `where` clause.
   */
  it("reads only this workspace's rows from a query with no filter at all", async () => {
    const rows = await scopedTransaction(app.db, scopeOf(mine), (tx) =>
      tx.select({ id: clients.id, workspaceId: clients.workspaceId }).from(clients),
    );

    expect(rows.map((row) => row.id)).toEqual([MY_CLIENT]);
    expect(rows.every((row) => row.workspaceId === seedIds.workspace)).toBe(true);
  });

  /**
   * The failure the barrier exists for. A `TenantContext` naming a workspace
   * this person does not belong to is exactly what a wrong context looks like,
   * and a policy that believed the setting would hand over every row.
   */
  it("gives nothing for a workspace the user is not a member of", async () => {
    const rows = await scopedTransaction(
      app.db,
      { workspaceId: OTHER_WORKSPACE, userId: seedIds.user, tokenHash: null },
      (tx) => tx.select({ id: clients.id }).from(clients),
    );

    expect(rows).toEqual([]);
  });

  it("refuses a write into another workspace", async () => {
    const refusal = await refusalOf(() =>
      scopedTransaction(app.db, scopeOf(mine), (tx) =>
        tx.insert(clients).values({
          id: newId(),
          workspaceId: OTHER_WORKSPACE,
          name: "Invasor",
          createdBy: seedIds.user,
        }),
      ),
    );

    expect(refusal.code).toBe(ROW_LEVEL_SECURITY);
  });

  /**
   * The escalation this design would otherwise open: a membership row in
   * somebody else's workspace makes `app.current_workspace()` resolve for it,
   * and every other policy follows.
   */
  it("refuses a membership forged into another workspace", async () => {
    const refusal = await refusalOf(() =>
      scopedTransaction(app.db, scopeOf(mine), (tx) =>
        tx.insert(workspaceMembers).values({
          id: newId(),
          workspaceId: OTHER_WORKSPACE,
          userId: seedIds.user,
          role: "owner",
        }),
      ),
    );

    expect(refusal.code).toBe(ROW_LEVEL_SECURITY);
  });

  /**
   * Loud, not empty. With no setting applied, `app.current_workspace()` casts
   * the word `unset` to a uuid, so a statement that arrives outside a lane
   * raises instead of returning nothing — an empty board nobody reports for a
   * week is the worse failure, and the one this catches.
   */
  it("refuses a statement sent outside any lane", async () => {
    const refusal = await refusalOf(() =>
      app.db.select({ id: clients.id }).from(clients),
    );

    expect(refusal.code).toBe(NOT_A_UUID);
    expect(refusal.message).toMatch(/unset/);
  });

  it("shows a person only themselves and the people they share a workspace with", async () => {
    const rows = await scopedTransaction(app.db, scopeOf(mine), (tx) =>
      tx.select({ id: users.id }).from(users),
    );

    expect(rows.map((row) => row.id)).toEqual([seedIds.user]);
  });

  /**
   * The bootstrap lane has no workspace yet, which is the whole reason it
   * exists: it must still find the memberships that decide which workspace to
   * open, and nothing beyond them.
   */
  it("lets the bootstrap lane see its own workspaces and no others", async () => {
    const rows = await scopedTransaction(
      app.db,
      { workspaceId: NO_WORKSPACE, userId: seedIds.user, tokenHash: null },
      (tx) => tx.select({ id: workspaces.id }).from(workspaces),
    );

    expect(rows.map((row) => row.id)).toEqual([seedIds.workspace]);
  });

  /**
   * The invitation lane, which is the only one whose credential is not a
   * session: a token's hash, and the person presenting it. The policies admit
   * it deliberately and narrowly — a live invitation, the workspace it names,
   * and the person who sent it — because the page has to say which workspace
   * and from whom before anybody has joined anything. It reads; it writes
   * nothing. Joining is `app.accept_invitation`, which decides and writes as the
   * owner (ADR 0003).
   */
  describe("the invitation lane", () => {
    const token = "a-token-that-never-leaves-this-test";
    let hash: string;
    const lane = () => ({ workspaceId: NO_WORKSPACE, userId: seedIds.user, tokenHash: hash });

    beforeEach(async () => {
      hash = await hashToken(token);
      await owner.db.insert(workspaceInvitations).values({
        id: newId(),
        workspaceId: OTHER_WORKSPACE,
        // The seed's own person: the invitation is theirs to accept.
        email: "henrique@planora.local",
        role: "member",
        tokenHash: hash,
        invitedBy: OTHER_USER,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    });

    it("shows the invitation, its workspace and who sent it", async () => {
      const seen = await scopedTransaction(
        app.db,
        { workspaceId: NO_WORKSPACE, userId: seedIds.user, tokenHash: hash },
        async (tx) => ({
          invitations: await tx
            .select({ id: workspaceInvitations.id })
            .from(workspaceInvitations),
          workspaces: await tx.select({ id: workspaces.id }).from(workspaces),
          inviters: await tx.select({ id: users.id }).from(users),
        }),
      );

      expect(seen.invitations).toHaveLength(1);
      expect(seen.workspaces.map((row) => row.id)).toContain(OTHER_WORKSPACE);
      expect(seen.inviters.map((row) => row.id)).toContain(OTHER_USER);
    });

    it("still shows nothing of the workspace's own work", async () => {
      const rows = await scopedTransaction(
        app.db,
        { workspaceId: NO_WORKSPACE, userId: seedIds.user, tokenHash: hash },
        (tx) => tx.select({ id: clients.id }).from(clients),
      );

      expect(rows).toEqual([]);
    });

    /**
     * The regression of 2026-09-22 → 24: with the barrier on, every acceptance
     * failed on the invitation's own `WITH CHECK`, and no test noticed because
     * none of them accepted anything as this role. This one goes through the
     * service, on this role, the way the page does.
     */
    it("joins through the service, as the application role", async () => {
      const accepted = await acceptInvitation(app.db, { token, userId: seedIds.user });

      expect(isRefused(accepted) ? accepted.reason : accepted.value).toStrictEqual({
        workspaceId: OTHER_WORKSPACE,
        role: "member",
      });

      const [membership] = await owner.db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, OTHER_WORKSPACE),
            eq(workspaceMembers.userId, seedIds.user),
          ),
        );
      expect(membership?.role).toBe("member");

      const [invitation] = await owner.db
        .select({ acceptedAt: workspaceInvitations.acceptedAt })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.tokenHash, hash));
      expect(invitation?.acceptedAt).not.toBeNull();
    });

    it("refuses the person presenting it when it was sent to somebody else", async () => {
      const [answer] = await scopedTransaction(
        app.db,
        // Somebody else's account, on my token.
        { workspaceId: NO_WORKSPACE, userId: OTHER_USER, tokenHash: hash },
        (tx) => tx.execute<{ outcome: string }>(sql`select outcome from app.accept_invitation(${newId()})`),
      );

      expect(answer?.outcome).toBe("wrong-account");
    });

    it("refuses a membership written by hand, whatever the role", async () => {
      const refusal = await refusalOf(() =>
        scopedTransaction(app.db, lane(), (tx) =>
          tx.insert(workspaceMembers).values({
            id: newId(),
            workspaceId: OTHER_WORKSPACE,
            userId: seedIds.user,
            // What the invitation lane could once write for itself.
            role: "owner",
          }),
        ),
      );

      expect(refusal.code).toBe(ROW_LEVEL_SECURITY);
    });

    it("cannot rewrite or remove the invitation it presents", async () => {
      const touched = await scopedTransaction(app.db, lane(), async (tx) => ({
        updated: await tx
          .update(workspaceInvitations)
          .set({ role: "admin", expiresAt: new Date(Date.now() + 365 * 86_400_000) })
          .returning({ id: workspaceInvitations.id }),
        deleted: await tx
          .delete(workspaceInvitations)
          .returning({ id: workspaceInvitations.id }),
      }));

      expect(touched).toStrictEqual({ updated: [], deleted: [] });
      const [row] = await owner.db
        .select({ role: workspaceInvitations.role })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.tokenHash, hash));
      expect(row?.role).toBe("member");
    });

    it("buys nothing once the invitation has been accepted", async () => {
      await owner.db
        .update(workspaceInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(workspaceInvitations.tokenHash, hash));

      const seen = await scopedTransaction(
        app.db,
        { workspaceId: NO_WORKSPACE, userId: seedIds.user, tokenHash: hash },
        (tx) => tx.select({ id: workspaces.id }).from(workspaces),
      );

      expect(seen.map((row) => row.id)).not.toContain(OTHER_WORKSPACE);
    });

    it("buys nothing once it has expired", async () => {
      await owner.db
        .update(workspaceInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceInvitations.tokenHash, hash));

      const accepted = await acceptInvitation(app.db, { token, userId: seedIds.user });

      expect(isRefused(accepted) && accepted.reason).toBe("expired");
      const memberships = await owner.db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, OTHER_WORKSPACE));
      expect(memberships).toHaveLength(1);
    });
  });

  /**
   * The drift test. It is keyed on the table list rather than on a column,
   * because a tenant-bearing table modelled without `workspace_id` — the way
   * `task_assignees` could have been — would pass a column-shaped guard
   * unnoticed. A table added without a policy turns this red.
   */
  it("leaves no table in public without FORCE row level security and a policy", async () => {
    const exempt = ["accounts", "rate_limits", "sessions", "verifications"];

    const rows = await owner.db.execute<{
      table_name: string;
      forced: boolean;
      policies: number;
    }>(sql`
      select c.relname as table_name,
             c.relrowsecurity and c.relforcerowsecurity as forced,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);

    const unguarded = rows
      .filter((row) => !exempt.includes(row.table_name))
      .filter((row) => !row.forced || row.policies === 0)
      .map((row) => row.table_name);

    expect(unguarded).toEqual([]);
    // And the exemptions are the four identity tables, not a list that grew.
    expect(rows.length - exempt.length).toBe(21);
  });

  /**
   * The negative control. If the owner could not read across workspaces either,
   * every test above would pass against a database where the policies did
   * nothing at all.
   */
  it("still reads both workspaces as the owner, so the suite can fail", async () => {
    const rows = await owner.db.select({ id: clients.id }).from(clients);

    expect(rows.some((row) => row.id === OTHER_CLIENT)).toBe(true);
  });

  it("connects as a role that cannot bypass what it is subject to", async () => {
    const [role] = await app.db.execute<{
      current_user: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(sql`
      select current_user, r.rolbypassrls, r.rolsuper
      from pg_roles r where r.rolname = current_user
    `);

    expect(role?.current_user).toBe(APP_ROLE);
    expect(role?.rolbypassrls).toBe(false);
    expect(role?.rolsuper).toBe(false);
  });
});

/** Postgres says which refusal it was; the driver's own message says only that a query failed. */
const ROW_LEVEL_SECURITY = "42501";
const NOT_A_UUID = "22P02";

/**
 * The database's refusal, unwrapped. Drizzle reports "Failed query: …" and
 * carries the real error as the cause, and it is the cause that says whether a
 * policy refused this or the statement was simply wrong.
 */
async function refusalOf(
  run: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as {
      code?: string;
      message?: string;
    };
    return { code: cause.code ?? "", message: cause.message ?? "" };
  }
  throw new Error("expected the database to refuse this, and it did not");
}

function scopeOf(context: { workspaceId: string; userId: string }) {
  return { workspaceId: context.workspaceId, userId: context.userId, tokenHash: null };
}

/** A second workspace, with a second person in it and nobody in common — and a
 * client on each side, so that "reads only mine" has both a row to find and a
 * row to miss. */
async function addTwoClients(db: Database): Promise<void> {
  await db.insert(users).values({
    id: OTHER_USER,
    name: "Outra Pessoa",
    email: "outra@example.com",
    emailVerified: true,
  });
  await db.insert(workspaces).values({
    id: OTHER_WORKSPACE,
    name: "Outro espaço",
    slug: "outro-espaco",
    createdBy: OTHER_USER,
  });
  await db.insert(workspaceMembers).values({
    id: newId(),
    workspaceId: OTHER_WORKSPACE,
    userId: OTHER_USER,
    role: "owner",
  });
  await db.insert(clients).values([
    {
      id: MY_CLIENT,
      workspaceId: seedIds.workspace,
      name: "Cliente meu",
      createdBy: seedIds.user,
    },
    {
      id: OTHER_CLIENT,
      workspaceId: OTHER_WORKSPACE,
      name: "Cliente alheio",
      createdBy: OTHER_USER,
    },
  ]);
}
