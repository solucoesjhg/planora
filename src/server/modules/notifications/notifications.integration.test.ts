import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fixedId } from "@/lib/id";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { notifications, outboxEvents, users, workspaceMembers } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { memorySender } from "@/server/email/sender";
import { dispatchPending, MAX_ATTEMPTS } from "@/server/events/dispatcher";
import { emit } from "@/server/events/outbox";
import { assignTask } from "@/server/modules/tasks/service";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { listInbox, markRead, savePreferences, unreadCount } from "./repository";
import { deliverPendingEmails, sendDigests } from "./service";

const suite = describe.skipIf(!hasDatabase);

suite("notifications", () => {
  let connection: Connection;
  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const anaId = fixedId("user", 2);
  const ana = () => tenantContext(seedIds.workspace, anaId, "member");
  const taskId = seedIds.task(1);

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
    await connection.db.insert(users).values({
      id: anaId,
      email: "ana@planora.local",
      name: "Ana",
      emailVerified: true,
    });
    await connection.db.insert(workspaceMembers).values({
      workspaceId: seedIds.workspace,
      userId: anaId,
      role: "member",
    });
  });

  it("tells the person a task was given to — not the person who gave it", async () => {
    await assignTask(connection.db, owner(), { taskId, userIds: [anaId] });
    await dispatchPending(connection.db);

    expect(await unreadCount(connection.db, ana())).toBe(1);
    expect(await unreadCount(connection.db, owner())).toBe(0);

    const [row] = await listInbox(connection.db, ana());
    expect(row).toMatchObject({
      type: "task.assigned",
      title: "TSK-1 é sua agora",
      emailStatus: "pending",
    });
    expect(row?.body).toContain("Henrique atribuiu TSK-1");
    expect(row?.href).toBe(`/projects/${seedIds.projects[0]}/tasks/${taskId}`);

    // Re-dispatching the same event tells nobody twice.
    await connection.db.update(outboxEvents).set({ processedAt: null });
    await dispatchPending(connection.db);
    expect(await listInbox(connection.db, ana())).toHaveLength(1);
  });

  it("honours a person's channels, and sends the email once", async () => {
    await savePreferences(connection.db, ana(), {
      channels: { "task.assigned": { inApp: true, email: false } },
      digest: "none",
    });
    await assignTask(connection.db, owner(), { taskId, userIds: [anaId] });
    await dispatchPending(connection.db);

    const [quiet] = await listInbox(connection.db, ana());
    expect(quiet?.emailStatus).toBe("none");

    await savePreferences(connection.db, ana(), {
      channels: { "comment.added": { inApp: true, email: true } },
      digest: "none",
    });
    await emit(connection.db, {
      workspaceId: seedIds.workspace,
      type: "comment.added",
      payload: { taskId, projectId: seedIds.projects[0], commentId: "c" },
      dedupeKey: "test:comment:1",
      actorId: seedIds.user,
    });
    await dispatchPending(connection.db);

    const sender = memorySender();
    const delivered = await deliverPendingEmails(connection.db, sender, "http://localhost:3000");
    expect(delivered).toEqual({ sent: 1, failed: 0 });
    expect(sender.outbox[0]?.to).toBe("ana@planora.local");
    expect(sender.outbox[0]?.subject).toBe("Comentário em TSK-1");
    expect(sender.outbox[0]?.text).toContain(`http://localhost:3000/projects/${seedIds.projects[0]}/tasks/${taskId}`);

    expect(await deliverPendingEmails(connection.db, sender, "http://localhost:3000")).toEqual({
      sent: 0,
      failed: 0,
    });
  });

  it("marks read, one or all", async () => {
    await assignTask(connection.db, owner(), { taskId, userIds: [anaId] });
    await emit(connection.db, {
      workspaceId: seedIds.workspace,
      type: "comment.added",
      payload: { taskId, projectId: seedIds.projects[0] },
      dedupeKey: "test:comment:2",
      actorId: seedIds.user,
    });
    await dispatchPending(connection.db);
    expect(await unreadCount(connection.db, ana())).toBe(2);

    const [first] = await listInbox(connection.db, ana());
    await markRead(connection.db, ana(), [first!.id]);
    expect(await unreadCount(connection.db, ana())).toBe(1);

    await markRead(connection.db, ana(), "all");
    expect(await unreadCount(connection.db, ana())).toBe(0);
  });

  it("sends a digest of what was left unread, at the cadence chosen", async () => {
    await savePreferences(connection.db, ana(), { channels: {}, digest: "daily" });
    await assignTask(connection.db, owner(), { taskId, userIds: [anaId] });
    await dispatchPending(connection.db);

    const sender = memorySender();
    const now = new Date();
    expect(await sendDigests(connection.db, sender, "http://localhost:3000", now)).toBe(1);
    expect(sender.outbox[0]?.subject).toBe("1 aviso do dia no Planora");
    expect(sender.outbox[0]?.text).toContain("TSK-1 é sua agora");

    // Not again today.
    expect(await sendDigests(connection.db, sender, "http://localhost:3000", now)).toBe(0);
    // Tomorrow, with nothing new, nothing is sent — but the period counts.
    const tomorrow = new Date(now.getTime() + 25 * 3600_000);
    await markRead(connection.db, ana(), "all");
    expect(await sendDigests(connection.db, sender, "http://localhost:3000", tomorrow)).toBe(0);
  });

  it("sets a poisoned event aside after the last attempt, keeping its error", async () => {
    await emit(connection.db, {
      workspaceId: seedIds.workspace,
      type: "task.completed",
      // A subject that is not an id: the activity row cannot be written.
      payload: { taskId: "not-an-id" },
      dedupeKey: "test:poison",
    });

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const result = await dispatchPending(connection.db);
      expect(result).toMatchObject({ failed: 1, abandoned: 0 });
    }
    const last = await dispatchPending(connection.db);
    expect(last).toMatchObject({ failed: 1, abandoned: 1 });

    const [row] = await connection.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, "test:poison"));
    expect(row?.processedAt).not.toBeNull();
    expect(row?.attempts).toBe(MAX_ATTEMPTS);
    expect(row?.lastError).toBeTruthy();

    // And the queue moves on.
    expect(await dispatchPending(connection.db)).toMatchObject({ processed: 0, failed: 0 });
    expect(await connection.db.select().from(notifications)).toHaveLength(0);
  });
});
