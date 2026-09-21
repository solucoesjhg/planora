import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { MAX_KEY_LENGTH } from "@/domain/kanban";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection, Transaction } from "@/server/db/client";
import { activityLogs, outboxEvents, taskDependencies, tasks } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { dispatchPending } from "@/server/events/dispatcher";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { moveTask } from "./service";

const suite = describe.skipIf(!hasDatabase);

suite("moveTask against a real database", () => {
  let connection: Connection;

  /**
   * The scope a Server Action opens in production (ADR 0002). The suite holds a
   * connection of its own, not the pool `withTenant` reaches for, so it opens
   * the scope itself and hands the service the transaction — which is what the
   * services now expect to be given.
   */
  const scoped = <T>(run: (tx: Transaction) => Promise<T>): Promise<T> =>
    connection.db.transaction(run);

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

    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: blockedTask,
        toColumnId: doneColumn,
      }),
    );

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
    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(5),
        toColumnId: doneColumn,
      }),
    );

    expect(isRefused(result) && result.reason).toBe("dependencies");
  });

  it("leaves exactly one event when a move succeeds", async () => {
    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(1),
        toColumnId: reviewColumn,
      }),
    );

    expect(isRefused(result)).toBe(false);

    const events = await connection.db.select().from(outboxEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("task.moved");
    expect(events[0]?.actorKind).toBe("user");
    expect(events[0]?.processedAt).toBeNull();
  });

  it("says a task was completed when it enters done, beside the move", async () => {
    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(1),
        toColumnId: doneColumn,
      }),
    );
    expect(isRefused(result)).toBe(false);

    const events = await connection.db.select().from(outboxEvents);
    expect(events.map((event) => event.type).sort()).toStrictEqual([
      "task.completed",
      "task.moved",
    ]);

    const completed = events.find((event) => event.type === "task.completed");
    expect((completed?.payload as { taskId?: string }).taskId).toBe(seedIds.task(1));
    expect((completed?.payload as { forced?: boolean }).forced).toBe(false);
  });

  it("releases whoever was waiting on the task it just completed", async () => {
    // TSK-3 waits on TSK-1 alone; TSK-4 waits on TSK-1 and on TSK-2, which is
    // still open. Finishing TSK-1 releases the first and not the second.
    await connection.db.insert(taskDependencies).values([
      {
        workspaceId: seedIds.workspace,
        taskId: seedIds.task(3),
        dependsOnId: seedIds.task(1),
      },
      {
        workspaceId: seedIds.workspace,
        taskId: seedIds.task(4),
        dependsOnId: seedIds.task(1),
      },
      {
        workspaceId: seedIds.workspace,
        taskId: seedIds.task(4),
        dependsOnId: seedIds.task(2),
      },
    ]);

    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(1),
        toColumnId: doneColumn,
      }),
    );
    expect(isRefused(result)).toBe(false);

    const resolved = (await connection.db.select().from(outboxEvents)).filter(
      (event) => event.type === "dependency.resolved",
    );
    expect(resolved).toHaveLength(1);
    expect((resolved[0]?.payload as { taskId?: string }).taskId).toBe(seedIds.task(3));
    expect((resolved[0]?.payload as { resolvedBy?: string }).resolvedBy).toBe(
      seedIds.task(1),
    );
  });

  it("archives the notes of the phase it leaves", async () => {
    await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(1),
        toColumnId: reviewColumn,
        phaseLabel: () => "Planejamento",
      }),
    );

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

    const refusal = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: withChecklist,
        toColumnId: doneColumn,
      }),
    );
    expect(isRefused(refusal) && refusal.reason).toBe("checklist");

    const forced = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: withChecklist,
        toColumnId: doneColumn,
        ack: "checklist",
      }),
    );
    expect(isRefused(forced)).toBe(false);

    // Forced into done: the move and the completion it implies, both saying so.
    const events = await connection.db.select().from(outboxEvents);
    expect(events.map((event) => event.type).sort()).toStrictEqual([
      "task.completed",
      "task.moved",
    ]);
    for (const event of events) {
      expect((event.payload as { forced?: boolean }).forced).toBe(true);
    }
  });

  it("writes one row when a card lands between two neighbours", async () => {
    const before = await connection.db
      .select({
        id: tasks.id,
        columnId: tasks.columnId,
        position: tasks.position,
      })
      .from(tasks)
      .orderBy(asc(tasks.number));

    // Put TSK-1 between the two cards that sit in the review column.
    const review = seedIds.column(0, 2);
    const inReview = before.filter((row) => row.columnId === review);

    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(1),
        toColumnId: review,
        afterTaskId: inReview[0]?.id ?? null,
        beforeTaskId: inReview[1]?.id ?? null,
      }),
    );
    expect(isRefused(result)).toBe(false);

    const after = await connection.db
      .select({
        id: tasks.id,
        columnId: tasks.columnId,
        position: tasks.position,
      })
      .from(tasks)
      .orderBy(asc(tasks.number));

    const changed = after.filter((row) => {
      const previous = before.find((each) => each.id === row.id);
      return (
        previous?.columnId !== row.columnId || previous?.position !== row.position
      );
    });

    // Exactly one: a fractional index moves a card without reindexing a column.
    expect(changed).toHaveLength(1);
    expect(changed[0]?.id).toBe(seedIds.task(1));

    if (inReview[0] && inReview[1]) {
      const moved = changed[0]!;
      expect(moved.position > inReview[0].position).toBe(true);
      expect(moved.position < inReview[1].position).toBe(true);
    }
  });


  it("rewrites a column whose keys have grown too long", async () => {
    const review = seedIds.column(0, 2);

    // A column that has been inserted into between the same two cards for a
    // long time: keys past the length the domain tolerates.
    const long = "V".repeat(MAX_KEY_LENGTH + 4);
    const inReview = await connection.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.columnId, review));

    for (const [index, row] of inReview.entries()) {
      await connection.db
        .update(tasks)
        .set({ position: `${long}${index}` })
        .where(eq(tasks.id, row.id));
    }

    const result = await scoped((tx) =>
      moveTask(tx, owner(), {
        taskId: seedIds.task(1),
        toColumnId: review,
      }),
    );
    expect(isRefused(result)).toBe(false);

    const after = await connection.db
      .select({ position: tasks.position })
      .from(tasks)
      .where(eq(tasks.columnId, review));

    expect(after.length).toBeGreaterThan(inReview.length);
    for (const row of after) {
      expect(row.position.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    }

    // And the order is still an order: every key distinct.
    expect(new Set(after.map((row) => row.position)).size).toBe(after.length);
  });

  it("refuses a viewer, and a workspace that is not the task's", async () => {
    const viewer = tenantContext(seedIds.workspace, seedIds.user, "viewer");
    const stranger = tenantContext(seedIds.projects[1], seedIds.user, "owner");

    const byViewer = await scoped((tx) =>
      moveTask(tx, viewer, {
        taskId: seedIds.task(1),
        toColumnId: doneColumn,
      }),
    );
    const byStranger = await scoped((tx) =>
      moveTask(tx, stranger, {
        taskId: seedIds.task(1),
        toColumnId: doneColumn,
      }),
    );

    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
    expect(isRefused(byStranger) && byStranger.reason).toBe("not-found");
  });
});

suite("the dispatcher", () => {
  let connection: Connection;

  /** The suite's own scope, as above. */
  const scoped = <T>(run: (tx: Transaction) => Promise<T>): Promise<T> =>
    connection.db.transaction(run);

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
    await scoped((tx) =>
      moveTask(
        tx,
        tenantContext(seedIds.workspace, seedIds.user, "owner"),
        // Into review, not done: one event, so the count below is about the
        // dispatcher's idempotency and nothing else.
        { taskId: seedIds.task(1), toColumnId: seedIds.column(0, 2) },
      ),
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
