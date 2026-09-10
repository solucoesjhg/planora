import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { createAuth } from "@/server/auth/config";
import type { Connection } from "@/server/db/client";
import {
  rateLimits,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { resetDatabase } from "@/server/db/seed";
import { memorySender } from "@/server/email/sender";
import { hashToken } from "@/lib/token";
import {
  ensurePersonalWorkspace,
  membershipsOf,
  resolveTenantContext,
} from "@/server/modules/workspaces/repository";
import {
  acceptInvitation,
  inviteMember,
} from "@/server/modules/workspaces/service";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";

const suite = describe.skipIf(!hasDatabase);

const password = "uma-senha-bem-longa";

suite("signing up", () => {
  let connection: Connection;
  let sender: ReturnType<typeof memorySender>;
  let auth: ReturnType<typeof createAuth>;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection.db);
    sender = memorySender();
    auth = createAuth({
      database: connection.db,
      sender,
      baseUrl: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-32",
      checkBreaches: false,
    });
  });

  it("gives a new account a workspace of its own, owned by them", async () => {
    await auth.api.signUpEmail({
      body: { name: "Henrique", email: "henrique@example.com", password },
    });

    const [user] = await connection.db
      .select()
      .from(users)
      .where(eq(users.email, "henrique@example.com"));
    expect(user).toBeDefined();

    const memberships = await membershipsOf(connection.db, user!.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");

    const [workspace] = await connection.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, memberships[0]!.workspaceId));
    expect(workspace?.name).toBe("Henrique");
    expect(workspace?.createdBy).toBe(user!.id);
  });

  it("sends the verification email through the configured sender", async () => {
    await auth.api.signUpEmail({
      body: { name: "Ana", email: "ana@example.com", password },
    });

    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]?.to).toBe("ana@example.com");
    expect(sender.outbox[0]?.subject).toContain("Confirme seu e-mail");
    expect(sender.outbox[0]?.html).toContain("http");
  });

  it("counts requests in the database and refuses the sixth signup in a minute", async () => {
    const attempt = (index: number) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.10",
          },
          body: JSON.stringify({
            name: `Pessoa ${index}`,
            email: `pessoa${index}@example.com`,
            password,
          }),
        }),
      );

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await attempt(index)).status);
    }

    // Five get through, the sixth is refused — and the counter is a row, not a
    // number in one instance's memory.
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(statuses.at(-1)).toBe(429);

    const counters = await connection.db.select().from(rateLimits);
    expect(counters.length).toBeGreaterThan(0);
  });

  it("refuses a weak password at the endpoint, with a message a person can act on", async () => {
    const signUp = (password: string, email: string) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Henrique Zanella", email, password }),
        }),
      );

    const short = await signUp("curta12", "a@example.com");
    const common = await signUp("senha123", "b@example.com");
    const own = await signUp("henrique-zanella", "henrique@example.com");
    const good = await signUp("trilha molhada de barro", "c@example.com");

    expect(short.status).toBe(400);
    expect(common.status).toBe(400);
    expect(own.status).toBe(400);
    expect(good.status).toBe(200);

    expect(((await common.json()) as { message?: string }).message).toContain(
      "mais usadas",
    );

    // Only the acceptable one created an account.
    expect(await connection.db.select().from(users)).toHaveLength(1);
  });

  it("survives four people with the same name signing up at once", async () => {
    /**
     * The slug comes from the name, so simultaneous signups race for it. Four
     * rather than two on purpose: the first fallback used the head of the user
     * id, and a UUID v7 starts with a timestamp — so accounts created in the
     * same instant collided on the fallback too. Found by four Playwright
     * workers all registering "Pessoa de Teste".
     */
    const created = await Promise.all(
      [1, 2, 3, 4].map((index) =>
        auth.api.signUpEmail({
          body: {
            name: "Pessoa de Teste",
            email: `pessoa${index}@example.com`,
            password,
          },
        }),
      ),
    );

    expect(new Set(created.map((result) => result.user.id)).size).toBe(4);

    const rows = await connection.db.select().from(workspaces);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(4);

    for (const result of created) {
      expect(await membershipsOf(connection.db, result.user.id)).toHaveLength(1);
    }
  });

  it("does not duplicate the account or the workspace on a repeated signup", async () => {
    // Better Auth reuses an unverified account and re-sends the verification
    // rather than erroring, which is also what keeps signup from telling a
    // stranger which addresses exist. What matters here is that our own hook
    // does not hand the same person a second workspace.
    await auth.api.signUpEmail({
      body: { name: "Ana", email: "ana@example.com", password },
    });
    await auth.api.signUpEmail({
      body: { name: "Ana de novo", email: "ana@example.com", password },
    });

    const rows = await connection.db
      .select()
      .from(users)
      .where(eq(users.email, "ana@example.com"));
    expect(rows).toHaveLength(1);

    const memberships = await membershipsOf(connection.db, rows[0]!.id);
    expect(memberships).toHaveLength(1);
  });
});

suite("resolving a workspace", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection.db);
  });

  async function register(name: string, email: string) {
    const auth = createAuth({
      database: connection.db,
      sender: memorySender(),
      baseUrl: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-32",
      checkBreaches: false,
    });
    await auth.api.signUpEmail({ body: { name, email, password } });

    const [user] = await connection.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    const memberships = await membershipsOf(connection.db, user!.id);
    return { userId: user!.id, workspaceId: memberships[0]!.workspaceId };
  }

  it("hands back a context for a workspace the user belongs to", async () => {
    const henrique = await register("Henrique", "h@example.com");

    const context = await resolveTenantContext(
      connection.db,
      henrique.userId,
      henrique.workspaceId,
    );

    expect(context).toStrictEqual({
      workspaceId: henrique.workspaceId,
      userId: henrique.userId,
      role: "owner",
    });
  });

  it("hands back nothing for somebody else's workspace", async () => {
    const henrique = await register("Henrique", "h@example.com");
    const ana = await register("Ana", "a@example.com");

    // The DAL turns this null into notFound(): a stranger does not learn that
    // the workspace exists.
    expect(
      await resolveTenantContext(connection.db, ana.userId, henrique.workspaceId),
    ).toBeNull();
  });

  it("repairs an account that ended up with no workspace", async () => {
    const henrique = await register("Henrique", "h@example.com");

    // The signup hook runs outside the account's transaction, so this is the
    // state a failure there would leave behind.
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, henrique.workspaceId));
    expect(await resolveTenantContext(connection.db, henrique.userId)).toBeNull();

    const repaired = await ensurePersonalWorkspace(connection.db, {
      id: henrique.userId,
      name: "Henrique",
      email: "h@example.com",
    });

    const context = await resolveTenantContext(connection.db, henrique.userId);
    expect(context?.workspaceId).toBe(repaired);
    expect(context?.role).toBe("owner");
  });

  it("does not hand out a second workspace when called twice at once", async () => {
    const henrique = await register("Henrique", "h@example.com");
    const user = { id: henrique.userId, name: "Henrique", email: "h@example.com" };

    const results = await Promise.all([
      ensurePersonalWorkspace(connection.db, user),
      ensurePersonalWorkspace(connection.db, user),
    ]);

    expect(results[0]).toBe(results[1]);
    expect(await membershipsOf(connection.db, henrique.userId)).toHaveLength(1);
  });
});

suite("invitations", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection.db);
  });

  async function register(name: string, email: string) {
    const auth = createAuth({
      database: connection.db,
      sender: memorySender(),
      baseUrl: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-32",
      checkBreaches: false,
    });
    await auth.api.signUpEmail({ body: { name, email, password } });

    const [user] = await connection.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    const memberships = await membershipsOf(connection.db, user!.id);
    return { userId: user!.id, workspaceId: memberships[0]!.workspaceId };
  }

  it("emails an invitation and lets the invitee join with the token", async () => {
    const owner = await register("Henrique", "h@example.com");
    const guest = await register("Ana", "a@example.com");
    const sender = memorySender();

    const invited = await inviteMember(
      connection.db,
      { workspaceId: owner.workspaceId, userId: owner.userId, role: "owner" },
      {
        email: "a@example.com",
        role: "member",
        baseUrl: "http://localhost:3000",
        sender,
      },
    );

    expect(isRefused(invited)).toBe(false);
    expect(sender.outbox[0]?.subject).toContain("convidou você");

    if (isRefused(invited)) return;
    const accepted = await acceptInvitation(connection.db, {
      token: invited.value.token,
      userId: guest.userId,
    });

    expect(isRefused(accepted)).toBe(false);

    const rows = await connection.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, owner.workspaceId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === guest.userId)?.role).toBe("member");
  });

  it("stores the invitation hashed, never the token itself", async () => {
    const owner = await register("Henrique", "h@example.com");

    const invited = await inviteMember(
      connection.db,
      { workspaceId: owner.workspaceId, userId: owner.userId, role: "owner" },
      {
        email: "convidada@example.com",
        baseUrl: "http://localhost:3000",
        sender: memorySender(),
      },
    );
    if (isRefused(invited)) throw new Error("expected an invitation");

    const [row] = await connection.db.select().from(workspaceInvitations);
    expect(row?.tokenHash).toBe(await hashToken(invited.value.token));
    expect(JSON.stringify(row)).not.toContain(invited.value.token);
  });

  it("refuses a member who cannot manage members", async () => {
    const owner = await register("Henrique", "h@example.com");

    const result = await inviteMember(
      connection.db,
      { workspaceId: owner.workspaceId, userId: owner.userId, role: "member" },
      {
        email: "outra@example.com",
        baseUrl: "http://localhost:3000",
        sender: memorySender(),
      },
    );

    expect(isRefused(result) && result.reason).toBe("forbidden");
  });

  it("refuses an expired token, and an unknown one", async () => {
    const owner = await register("Henrique", "h@example.com");
    const guest = await register("Ana", "a@example.com");

    const invited = await inviteMember(
      connection.db,
      { workspaceId: owner.workspaceId, userId: owner.userId, role: "owner" },
      {
        email: "a@example.com",
        baseUrl: "http://localhost:3000",
        sender: memorySender(),
        now: new Date(Date.now() - 30 * 86_400_000),
      },
    );
    if (isRefused(invited)) throw new Error("expected an invitation");

    const expired = await acceptInvitation(connection.db, {
      token: invited.value.token,
      userId: guest.userId,
    });
    const unknown = await acceptInvitation(connection.db, {
      token: "nao-existe",
      userId: guest.userId,
    });

    expect(isRefused(expired) && expired.reason).toBe("expired");
    expect(isRefused(unknown) && unknown.reason).toBe("invalid-token");
  });
});
