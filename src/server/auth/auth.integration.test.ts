import { tenantContext, type Role } from "@/server/auth/tenant";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signJWT } from "better-auth/crypto";
import { CONFIRMATION_HEADER } from "@/lib/confirmation-link";
import { isRefused } from "@/lib/result";
import { createAuth } from "@/server/auth/config";
import type { Connection } from "@/server/db/client";
import {
  rateLimits,
  sessions,
  users,
  verifications,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  outboxEvents,
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
  previewInvitation,
} from "@/server/modules/workspaces/service";
import { connect, connectAndMigrate, hasDatabase } from "@/server/test-support/database";

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

  /**
   * The link confirms nothing on its own (ADR 0007): it leads to the login
   * form, and signing in there with the account's password is what confirms
   * the address. A link sent before that decision still points at Better
   * Auth's endpoint, which now sends it to the same form — confirming nobody
   * and signing nobody in on the way, whatever a mail scanner follows.
   */
  it("confirms nothing when Better Auth's own link is followed", async () => {
    await auth.api.signUpEmail({
      body: { name: "Ana", email: "ana@example.com", password },
    });
    const token = confirmationToken();

    const response = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/verify-email?token=${token}&callbackURL=%2Flogin%3Fverificado%3D1`,
        { redirect: "manual" },
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/login?confirmar=${token}`);
    const [user] = await connection.db
      .select()
      .from(users)
      .where(eq(users.email, "ana@example.com"));
    expect(user?.emailVerified).toBe(false);
    expect(await connection.db.select().from(sessions)).toHaveLength(0);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends the link to the login form, carrying the token", async () => {
    await auth.api.signUpEmail({
      body: {
        name: "Ana",
        email: "ana@example.com",
        password,
        // What the register form sends for somebody arriving on their own.
        callbackURL: "/dashboard",
      },
    });

    const link = new URL(confirmationLink());

    // No `next`: the login form already goes to the dashboard.
    expect(link.origin + link.pathname).toBe("http://localhost:3000/login");
    expect([...link.searchParams.keys()]).toEqual(["confirmar"]);
  });

  /**
   * Sign-up may have been on its way to an invitation. That survives as
   * `next`, so signing in continues the journey rather than dropping the
   * person on the dashboard.
   */
  it("keeps where the sign-up was going", async () => {
    await auth.api.signUpEmail({
      body: {
        name: "Ana",
        email: "ana@example.com",
        password,
        callbackURL: "/invitations/abc",
      },
    });

    const link = new URL(confirmationLink());

    expect(link.searchParams.get("next")).toBe("/invitations/abc");
  });

  /**
   * Sign-up with no callback at all: Better Auth substitutes "/", which is the
   * marketing page. Somebody who has just confirmed an address belongs on the
   * dashboard, so the link carries no `next` rather than that one.
   */
  it("does not carry the marketing page as a destination", async () => {
    await auth.api.signUpEmail({
      body: { name: "Ana", email: "ana@example.com", password },
    });

    const link = new URL(confirmationLink());

    expect(link.searchParams.get("next")).toBeNull();
  });

  /** The link out of the message the memory sender collected. */
  function confirmationLink(): string {
    const message = sender.outbox.at(-1);
    const link = (message?.text ?? "").match(/https?:\/\/\S*\/login\?confirmar=\S*/)?.[0];
    if (!link) throw new Error("no confirmation link in the message");
    return link.replaceAll("&amp;", "&");
  }

  function confirmationToken(): string {
    const token = new URL(confirmationLink()).searchParams.get("confirmar");
    if (!token) throw new Error("no token in the confirmation link");
    return token;
  }

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
    // Better Auth answers a repeated sign-up exactly as a first one, which is
    // what keeps sign-up from telling a stranger which addresses exist. What
    // matters here is that our own hook does not hand the same person a second
    // workspace.
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

  /**
   * It used to send nothing at all, and the owner of the address waited for a
   * message that never came (ADR 0007). The answer to the request is the same
   * as for a new address; the mailbox is where the difference is told.
   */
  it("tells the mailbox when the address already has an account", async () => {
    await auth.api.signUpEmail({
      body: { name: "Ana", email: "ana@example.com", password },
    });
    await connection.db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.email, "ana@example.com"));
    sender.outbox.length = 0;

    const again = await auth.api.signUpEmail({
      body: { name: "Ana", email: "ana@example.com", password: "outra frase qualquer" },
    });

    expect(again.token).toBeNull();
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]?.to).toBe("ana@example.com");
    expect(sender.outbox[0]?.subject).toBe("Este e-mail já tem uma conta no Planora");
    expect(sender.outbox[0]?.text).toContain("http://localhost:3000/login");
    // It greets nobody: the name on an account may be a stranger's choice.
    expect(sender.outbox[0]?.text).not.toContain("Ana");
  });
});

/**
 * ADR 0007. An address is confirmed by whoever holds both its mailbox and the
 * account's password: the link carries a token to the login form, and signing
 * in with the token and the password is what confirms it.
 */
suite("confirming an address", () => {
  const secret = "test-secret-test-secret-test-secret-32";
  const ana = "ana@example.com";
  const anasPassword = "trilha molhada de barro";
  const strangersPassword = "senha que so o estranho sabe";

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
      secret,
      checkBreaches: false,
    });
  });

  const signUp = (email: string, password: string, name = "Ana") =>
    auth.api.signUpEmail({ body: { name, email, password } });

  const signIn = (email: string, password: string, token?: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { [CONFIRMATION_HEADER]: token } : {}),
        },
        body: JSON.stringify({ email, password }),
      }),
    );

  /** The token out of the last message sent to an address. */
  function tokenSentTo(email: string): string {
    const message = sender.outbox.filter((sent) => sent.to === email).at(-1);
    const token = (message?.text ?? "").match(/\/login\?confirmar=([^&\s]+)/)?.[1];
    if (!token) throw new Error(`no confirmation link was sent to ${email}`);
    return token;
  }

  async function verified(email: string): Promise<boolean | undefined> {
    const [user] = await connection.db.select().from(users).where(eq(users.email, email));
    return user?.emailVerified;
  }

  it("confirms the address when the link arrives with the account's password", async () => {
    await signUp(ana, anasPassword);

    const response = await signIn(ana, anasPassword, tokenSentTo(ana));

    expect(response.status).toBe(200);
    expect(await verified(ana)).toBe(true);
    expect(await connection.db.select().from(sessions)).toHaveLength(1);
  });

  it("confirms nothing with a password that is not the account's", async () => {
    await signUp(ana, anasPassword);

    const response = await signIn(ana, strangersPassword, tokenSentTo(ana));

    expect(response.status).toBe(401);
    expect(await verified(ana)).toBe(false);
    expect(await connection.db.select().from(sessions)).toHaveLength(0);
  });

  it("confirms only the address the link was sent to", async () => {
    await signUp(ana, anasPassword);
    await signUp("bia@example.com", anasPassword, "Bia");

    const response = await signIn("bia@example.com", anasPassword, tokenSentTo(ana));

    expect(response.status).toBe(403);
    expect(await verified("bia@example.com")).toBe(false);
    expect(await verified(ana)).toBe(false);
  });

  it("confirms nothing with a token that is forged or has expired", async () => {
    await signUp(ana, anasPassword);

    const forged = await signJWT({ email: ana }, "another-secret-another-secret-32", 900);
    const expired = await signJWT({ email: ana }, secret, -60);
    // A change of address is a different kind of token, even when it is ours.
    const changeOfAddress = await signJWT(
      { email: ana, updateTo: "outro@example.com" },
      secret,
      900,
    );

    for (const token of [forged, expired, changeOfAddress, "not-a-token"]) {
      expect((await signIn(ana, anasPassword, token)).status).toBe(403);
    }
    expect(await verified(ana)).toBe(false);
  });

  /**
   * An expired link is not a dead end: the right password asks for a fresh
   * one. The wrong password asks for nothing, so a stranger cannot fill
   * somebody's mailbox from the login form.
   */
  it("sends a fresh link to an unconfirmed account's owner, and to nobody else", async () => {
    await signUp(ana, anasPassword);
    sender.outbox.length = 0;

    expect((await signIn(ana, strangersPassword)).status).toBe(401);
    expect(sender.outbox).toHaveLength(0);

    expect((await signIn(ana, anasPassword)).status).toBe(403);
    expect(sender.outbox).toHaveLength(1);
    expect((await signIn(ana, anasPassword, tokenSentTo(ana))).status).toBe(200);
  });

  /**
   * The audit of 2026-09-24: somebody signs up first with Ana's address and a
   * password of their own. When Ana signs up she is answered as anyone is,
   * and "Reenviar" sends her a link — to the stranger's account. Opening it
   * used to confirm that account, stranger's password and all.
   */
  it("never lets in the stranger who signed up first with somebody's address", async () => {
    await signUp(ana, strangersPassword, "Visitante");

    // Ana signs up herself, and is told — by email, not by the answer.
    const answer = await signUp(ana, anasPassword);
    expect(answer.token).toBeNull();
    expect(sender.outbox.at(-1)?.subject).toBe("Este e-mail já tem uma conta no Planora");

    // "Reenviar", and the link, opened with her own password: nothing.
    await auth.api.sendVerificationEmail({ body: { email: ana } });
    const token = tokenSentTo(ana);
    expect((await signIn(ana, anasPassword, token)).status).toBe(401);
    expect(await verified(ana)).toBe(false);

    // Nor with the old endpoint, which a scanner might follow first.
    await auth.handler(
      new Request(`http://localhost:3000/api/auth/verify-email?token=${token}`, {
        redirect: "manual",
      }),
    );
    expect(await verified(ana)).toBe(false);

    // The stranger holds a password and no mailbox: still refused.
    expect((await signIn(ana, strangersPassword)).status).toBe(403);
    expect(await connection.db.select().from(sessions)).toHaveLength(0);

    // Ana takes the address back from the mailbox, and the stranger's
    // password goes with it.
    await auth.api.requestPasswordReset({ body: { email: ana, redirectTo: "/reset-password" } });
    const reset = sender.outbox.at(-1)?.text.match(/\/reset-password\/([^?\s]+)\?/)?.[1];
    if (!reset) throw new Error("no reset link in the message");
    await auth.api.resetPassword({ body: { token: reset, newPassword: anasPassword } });

    expect(await verified(ana)).toBe(true);
    expect((await signIn(ana, strangersPassword)).status).toBe(401);
    expect((await signIn(ana, anasPassword)).status).toBe(200);
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

    // What the verification link does. Nobody signs in unverified, so every
    // account that can reach an invitation has been through it — and an
    // invitation belongs to a verified address (ADR 0003).
    const [user] = await connection.db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.email, email))
      .returning();
    const memberships = await membershipsOf(connection.db, user!.id);
    return { userId: user!.id, workspaceId: memberships[0]!.workspaceId };
  }

  function invite(
    host: { workspaceId: string; userId: string },
    role: Role,
    input: { email: string; role?: Role; now?: Date },
  ) {
    return inviteMember(connection.db, tenantContext(host.workspaceId, host.userId, role), {
      baseUrl: "http://localhost:3000",
      sender: memorySender(),
      ...input,
    });
  }

  it("leaves no invitation behind when the message cannot be delivered", async () => {
    const refusing = {
      name: "refusing",
      async send() {
        // What Resend answers when the sender is its test domain and the
        // recipient is anybody but the account holder.
        throw new Error("You can only send testing emails to your own email address");
      },
    };

    const host = await register("Anfitriã", "anfitria@example.com");

    const result = await inviteMember(
      connection.db,
      tenantContext(host.workspaceId, host.userId, "owner"),
      {
        email: "outra.pessoa@example.com",
        baseUrl: "http://localhost:3000",
        sender: refusing,
      },
    );

    expect(isRefused(result) && result.reason).toBe("undeliverable");

    // Nothing pending: a second attempt must not answer "already invited".
    const rows = await connection.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.email, "outra.pessoa@example.com"));
    expect(rows).toHaveLength(0);
  });

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

    // Delivered, so it is also an event (§4.5).
    const events = await connection.db.select().from(outboxEvents);
    expect(events.map((event) => event.type)).toStrictEqual(["member.invited"]);

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

  /**
   * The audit of 2026-09-24 (ADR 0003): the form never offered `owner`, and the
   * Server Action behind it accepted it anyway — an admin could invite a second
   * account of their own as owner and delete the workspace from there.
   */
  it("lets nobody grant ownership, or a role above their own", async () => {
    const owner = await register("Henrique", "h@example.com");

    const asOwner = await invite(owner, "owner", { email: "o@example.com", role: "owner" });
    const asAdmin = await invite(owner, "admin", { email: "o@example.com", role: "owner" });
    const byManager = await invite(owner, "manager", { email: "m@example.com", role: "viewer" });

    expect(isRefused(asOwner) && asOwner.reason).toBe("forbidden-role");
    expect(isRefused(asAdmin) && asAdmin.reason).toBe("forbidden-role");
    expect(isRefused(byManager) && byManager.reason).toBe("forbidden");
    expect(await connection.db.select().from(workspaceInvitations)).toHaveLength(0);

    // An admin may hand on what an admin holds.
    const adminByAdmin = await invite(owner, "admin", { email: "a@example.com", role: "admin" });
    expect(isRefused(adminByAdmin)).toBe(false);
  });

  it("will not redeem an owner invitation written before the rule", async () => {
    const owner = await register("Henrique", "h@example.com");
    const guest = await register("Ana", "a@example.com");
    const token = "um-convite-de-dono-antigo";

    await connection.db.insert(workspaceInvitations).values({
      workspaceId: owner.workspaceId,
      email: "a@example.com",
      role: "owner",
      tokenHash: await hashToken(token),
      invitedBy: owner.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const preview = await previewInvitation(connection.db, token, { email: "a@example.com" });
    const accepted = await acceptInvitation(connection.db, { token, userId: guest.userId });

    expect(preview.status).toBe("invalid");
    expect(isRefused(accepted) && accepted.reason).toBe("invalid-token");
    expect(await membershipsOf(connection.db, guest.userId)).toHaveLength(1);
  });

  it("joins only the account the invitation was sent to", async () => {
    const owner = await register("Henrique", "h@example.com");
    const guest = await register("Ana", "a@example.com");
    const stranger = await register("Outra", "outra@example.com");

    const invited = await invite(owner, "owner", { email: "A@Example.com", role: "manager" });
    if (isRefused(invited)) throw new Error("expected an invitation");
    const { token } = invited.value;

    // Asked before the click, so the wrong account never sees a button.
    const theirs = await previewInvitation(connection.db, token, { email: "outra@example.com" });
    const hers = await previewInvitation(connection.db, token, { email: "a@example.com" });
    expect(theirs.status).toBe("wrong-account");
    expect(hers.status).toBe("open");

    // A forwarded link is not a key.
    const forwarded = await acceptInvitation(connection.db, { token, userId: stranger.userId });
    expect(isRefused(forwarded) && forwarded.reason).toBe("wrong-account");
    expect(await membershipsOf(connection.db, stranger.userId)).toHaveLength(1);

    // And it did not spend the invitation on the way.
    const accepted = await acceptInvitation(connection.db, { token, userId: guest.userId });
    expect(isRefused(accepted) ? accepted.reason : accepted.value).toStrictEqual({
      workspaceId: owner.workspaceId,
      role: "manager",
    });
  });

  it("refuses the invited address while it is still unverified", async () => {
    const owner = await register("Henrique", "h@example.com");
    const guest = await register("Ana", "a@example.com");
    await connection.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, guest.userId));

    const invited = await invite(owner, "owner", { email: "a@example.com" });
    if (isRefused(invited)) throw new Error("expected an invitation");

    const accepted = await acceptInvitation(connection.db, {
      token: invited.value.token,
      userId: guest.userId,
    });
    expect(isRefused(accepted) && accepted.reason).toBe("wrong-account");
  });

  /**
   * Two clicks at once, on connections that are genuinely separate: the read and
   * the write used to be two statements with nothing between them, and both
   * got in. The row lock makes the second wait, and find the invitation spent.
   */
  it("spends an invitation once when two acceptances race", async () => {
    const owner = await register("Henrique", "h@example.com");
    const guest = await register("Ana", "a@example.com");

    const invited = await invite(owner, "owner", { email: "a@example.com" });
    if (isRefused(invited)) throw new Error("expected an invitation");

    const first = connect();
    const second = connect();
    try {
      const results = await Promise.all(
        [first, second].map((side) =>
          acceptInvitation(side.db, { token: invited.value.token, userId: guest.userId }),
        ),
      );

      const reasons = results.map((result) => (isRefused(result) ? result.reason : "joined"));
      expect(reasons.sort()).toStrictEqual(["invalid-token", "joined"]);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }

    const members = await connection.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, owner.workspaceId));
    expect(members).toHaveLength(2);
  });
});

suite("recovering a password", () => {
  let connection: Connection;
  let sender: ReturnType<typeof memorySender>;
  let auth: ReturnType<typeof createAuth>;

  const email = "henrique@example.com";
  const newPassword = "trilha molhada de barro";

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
    await auth.api.signUpEmail({
      body: { name: "Henrique Zanella", email, password },
    });
    // Sign-in needs a verified address; recovery itself does not.
    await connection.db.update(users).set({ emailVerified: true }).where(eq(users.email, email));
    sender.outbox.length = 0;
  });

  /** Asks for the link and reads the token out of the message. */
  async function requestToken(): Promise<string> {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    const message = sender.outbox.at(-1);
    expect(message?.to).toBe(email);
    expect(message?.subject).toContain("Redefinir sua senha");
    const token = message?.text.match(/\/reset-password\/([^?\s]+)\?/)?.[1];
    if (!token) throw new Error("no reset link in the message");
    return token;
  }

  const reset = (token: string, newPassword: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      }),
    );

  const signIn = (password: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    );

  it("emails a link that works once, signs out every session, and swaps the password", async () => {
    expect((await signIn(password)).status).toBe(200);
    expect(await connection.db.select().from(sessions)).toHaveLength(1);

    const token = await requestToken();
    expect((await reset(token, newPassword)).status).toBe(200);

    // The token was consumed: the row is gone and a second use is refused.
    expect(await connection.db.select().from(verifications)).toHaveLength(0);
    expect((await reset(token, "outra frase comprida")).status).toBe(400);

    // Whoever was signed in with the old password no longer is.
    expect(await connection.db.select().from(sessions)).toHaveLength(0);

    expect((await signIn(password)).status).toBe(401);
    expect((await signIn(newPassword)).status).toBe(200);
  });

  /**
   * The reset link was delivered to the mailbox, and the password is the one
   * its holder just chose: everything confirming an address asks for
   * (ADR 0007).
   */
  it("confirms an address nobody had confirmed", async () => {
    await connection.db.update(users).set({ emailVerified: false }).where(eq(users.email, email));

    const token = await requestToken();
    expect((await reset(token, newPassword)).status).toBe(200);

    const [user] = await connection.db.select().from(users).where(eq(users.email, email));
    expect(user?.emailVerified).toBe(true);
    expect((await signIn(newPassword)).status).toBe(200);
  });

  it("answers an unknown address exactly as a known one, and sends nothing", async () => {
    const answer = await auth.api.requestPasswordReset({
      body: { email: "ninguem@example.com", redirectTo: "/reset-password" },
    });

    expect(answer.status).toBe(true);
    expect(sender.outbox).toHaveLength(0);
  });

  it("holds the new password to the policy, including the person's own name", async () => {
    const token = await requestToken();

    const own = await reset(token, "henrique-zanella");
    const common = await reset(token, "senha123");

    expect(own.status).toBe(400);
    expect(((await own.json()) as { message?: string }).message).toContain("nome");
    expect(common.status).toBe(400);
    expect(((await common.json()) as { message?: string }).message).toContain("mais usadas");

    // A refused password does not spend the token.
    expect((await reset(token, newPassword)).status).toBe(200);
  });

  it("sends the link's visitor to the page with the token, or with the error", async () => {
    const token = await requestToken();
    const visit = (value: string) =>
      auth.handler(
        new Request(
          `http://localhost:3000/api/auth/reset-password/${value}?callbackURL=%2Freset-password`,
          { redirect: "manual" },
        ),
      );

    const good = await visit(token);
    expect(good.status).toBe(302);
    expect(good.headers.get("location")).toBe(
      `http://localhost:3000/reset-password?token=${token}`,
    );

    const bad = await visit("nao-existe");
    expect(bad.status).toBe(302);
    expect(bad.headers.get("location")).toBe(
      "http://localhost:3000/reset-password?error=INVALID_TOKEN",
    );
  });
});
