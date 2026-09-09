import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { createAuth } from "@/server/auth/config";
import type { Connection } from "@/server/db/client";
import { users, workspaceMembers, workspaces } from "@/server/db/schema";
import { resetDatabase } from "@/server/db/seed";
import { memorySender } from "@/server/email/sender";
import {
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
