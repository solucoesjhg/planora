import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { activityLogs, outboxEvents, tasks } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { dispatchPending } from "@/server/events/dispatcher";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { moveTask } from "./service";

const suite = describe.skipIf(!hasDatabase);

suite("moveTask against a real database", () => {
  let connection: Connection;

  const doneColumn = seedIds.column(0, 3);
  const reviewColumn = seedIds.column(0, 2);
  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  it("refuses to move a blocked task into done, and writes nothing", async () => {
    const blockedTask = seedIds.task(2);

    const result = await moveTask(connection.db, owner(), {
      taskId: blockedTask,
      toColumnId: doneColumn,
    });

    expect(isRefused(result) && result.reason).toBe("blocked");

    const [row] = await connection.db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(eq(tasks.id, blockedTask));
    expect(row?.columnId).not.toBe(doneColumn);

    const events = await connection.db.select().from(outboxEvents);
    expect(events).toHaveLength(0);
  });

  it("refuses a task whose dependency is not done", async () => {
    const result = await moveTask(connection.db, owner(), {
      taskId: seedIds.task(5),
      toColumnId: doneColumn,
    });

    expect(isRefused(result) && result.reason).toBe("dependencies");
  });

  it("leaves exactly one event when a move succeeds", async () => {
    const result = await moveTask(connection.db, owner(), {
      taskId: seedIds.task(1),
      toColumnId: doneColumn,
    });

    expect(isRefused(result)).toBe(false);

    const events = await connection.db.select().from(outboxEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("task.moved");
    expect(events[0]?.actorKind).toBe("user");
    expect(events[0]?.processedAt).toBeNull();
  });

  it("archives the notes of the phase it leaves", async () => {
    await moveTask(connection.db, owner(), {
      taskId: seedIds.task(1),
      toColumnId: reviewColumn,
      phaseLabel: () => "Planejamento",
    });

    const [row] = await connection.db
      .select({ body: tasks.body, notes: tasks.internalNotes })
      .from(tasks)
      .where(eq(tasks.id, seedIds.task(1)));

    expect(row?.notes).toBe("");
    expect(row?.body).toContain("Planejamento");
    expect(row?.body).toContain("Nota interna da fase.");
  });

  it("takes an acknowledgement for an open checklist, and only for that", async () => {
    const withChecklist = seedIds.task(6);

    const refusal = await moveTask(connection.db, owner(), {
      taskId: withChecklist,
      toColumnId: doneColumn,
    });
    expect(isRefused(refusal) && refusal.reason).toBe("checklist");

    const forced = await moveTask(connection.db, owner(), {
      taskId: withChecklist,
      toColumnId: doneColumn,
      ack: "checklist",
    });
    expect(isRefused(forced)).toBe(false);

    const events = await connection.db.select().from(outboxEvents);
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { forced?: boolean }).forced).toBe(true);
  });

  it("refuses a viewer, and a workspace that is not the task's", async () => {
    const viewer = tenantContext(seedIds.workspace, seedIds.user, "viewer");
    const stranger = tenantContext(seedIds.projects[1], seedIds.user, "owner");

    const byViewer = await moveTask(connection.db, viewer, {
      taskId: seedIds.task(1),
      toColumnId: doneColumn,
    });
    const byStranger = await moveTask(connection.db, stranger, {
      taskId: seedIds.task(1),
      toColumnId: doneColumn,
    });

    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
    expect(isRefused(byStranger) && byStranger.reason).toBe("not-found");
  });
});

suite("the dispatcher", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  it("turns one event into one activity entry, however often it runs", async () => {
    await moveTask(
      connection.db,
      tenantContext(seedIds.workspace, seedIds.user, "owner"),
      { taskId: seedIds.task(1), toColumnId: seedIds.column(0, 3) },
    );

    const first = await dispatchPending(connection.db);
    const second = await dispatchPending(connection.db);

    expect(first.processed).toBe(1);
    expect(first.failed).toBe(0);
    // Nothing pending the second time — and no duplicate line either.
    expect(second.processed).toBe(0);

    const entries = await connection.db.select().from(activityLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.verb).toBe("task.moved");
    expect(entries[0]?.subjectType).toBe("task");
    expect(entries[0]?.subjectId).toBe(seedIds.task(1));
  });
});
