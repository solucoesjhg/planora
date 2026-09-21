import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection, Transaction } from "@/server/db/client";
import { outboxEvents, taskAssignees, taskComments, tasks } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { connect, connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { loadTaskDocument, nextTaskNumber } from "./repository";
import {
  addChecklistItem,
  addComment,
  addDependency,
  assignTask,
  createTask,
  editComment,
  removeComment,
  removeDependency,
  setChecklistItem,
  updateTask,
} from "./service";

const suite = describe.skipIf(!hasDatabase);

suite("the task as a document", () => {
  let connection: Connection;
  /** Separate connections, or nothing about concurrency is being tested. */
  let elsewhere: Connection;

  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const viewer = () => tenantContext(seedIds.workspace, seedIds.user, "viewer");
  const projectId = seedIds.projects[0]!;

  beforeAll(async () => {
    connection = await connectAndMigrate();
    elsewhere = connect(8);
  });

  afterAll(async () => {
    await Promise.all([connection.close(), elsewhere.close()]);
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  /**
   * The scope the Server Action opens, opened here on the suite's own
   * connection (ADR 0002).
   *
   * From Phase 10 a service joins the scope it is handed and, handed a pool
   * instead, opens one through `inScope` — on `getDatabase()`, which is the
   * application's pool and, for this suite, another database entirely
   * (test-support/database-url.ts). Passing the transaction is both what the
   * request path does and the only way the writes land where the assertions
   * read them.
   */
  const scoped = <T>(run: (tx: Transaction) => Promise<T>): Promise<T> =>
    connection.db.transaction(run);

  /**
   * Assignees (§7 Phase 8): `task_assignees` has waited since Phase 2. The
   * whole set is written at once, anyone named has to be in the workspace, and
   * the event carries the names so the feed can say who.
   */
  it("gives a task to people in the workspace, and takes it back", async () => {
    const taskId = seedIds.task(1);

    const given = await scoped((tx) =>
      assignTask(tx, owner(), {
        taskId,
        userIds: [seedIds.user, seedIds.user],
      }),
    );
    expect(isRefused(given)).toBe(false);

    const document = await loadTaskDocument(connection.db, owner(), taskId);
    expect(document?.assignees).toEqual([{ userId: seedIds.user, name: "Henrique" }]);

    const [event] = await connection.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.workspaceId, seedIds.workspace), eq(outboxEvents.type, "task.assigned")));
    expect(event?.payload).toMatchObject({
      taskId,
      projectId,
      userIds: [seedIds.user],
      names: ["Henrique"],
    });

    const taken = await scoped((tx) =>
      assignTask(tx, owner(), { taskId, userIds: [] }),
    );
    expect(isRefused(taken)).toBe(false);
    expect(
      await connection.db.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId)),
    ).toHaveLength(0);
  });

  it("refuses somebody who is not in the workspace, and a viewer who may not write", async () => {
    const taskId = seedIds.task(1);

    const stranger = await scoped((tx) =>
      assignTask(tx, owner(), {
        taskId,
        userIds: ["0192b1f0-0000-7000-8000-000000000999"],
      }),
    );
    expect(isRefused(stranger) && stranger.reason).toBe("not-a-member");
    expect(
      await connection.db.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId)),
    ).toHaveLength(0);

    const byViewer = await scoped((tx) =>
      assignTask(tx, viewer(), {
        taskId,
        userIds: [seedIds.user],
      }),
    );
    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
  });

  it("creates a task with the project's next number, at the end of its column", async () => {
    const column = seedIds.column(0, 1);

    const created = await scoped((tx) =>
      createTask(tx, owner(), {
        projectId,
        columnId: column,
        title: "  Refazer o rodapé  ",
      }),
    );
    if (isRefused(created)) throw new Error(created.reason);

    // The seed writes twelve tasks into this project.
    expect(created.value.number).toBe(13);

    const [row] = await connection.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, created.value.taskId));

    expect(row?.title).toBe("Refazer o rodapé");
    expect(row?.columnId).toBe(column);

    const others = await connection.db
      .select({ position: tasks.position })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, seedIds.workspace), eq(tasks.columnId, column)),
      );
    const highest = others.map((each) => each.position).sort().at(-1);
    expect(row?.position).toBe(highest);
  });

  it("makes a second writer wait for the number", async () => {
    // The regression: `max(number) + 1` without a lock hands the same number to
    // two transactions that overlap, and the second insert dies on the unique
    // index. Proof that the lock is there: while one connection holds it, the
    // other cannot get past the read.
    let second: Promise<number> | null = null;

    await connection.db.transaction(async (first) => {
      await nextTaskNumber(first, owner(), projectId);

      second = elsewhere.db.transaction(async (other) =>
        nextTaskNumber(other, owner(), projectId),
      );

      const outcome = await Promise.race([
        second.then(() => "answered" as const),
        new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 300)),
      ]);

      expect(outcome).toBe("waiting");
    });

    // And once the first transaction ends, it goes through.
    expect(await second!).toBe(13);
  });

  it("gives cards written at the same moment different numbers", async () => {
    const titles = ["A", "B", "C", "D", "E", "F"];

    // Six scopes on six separate connections, which is what the six Server
    // Actions would be.
    const results = await Promise.all(
      titles.map((title) =>
        elsewhere.db.transaction((tx) =>
          createTask(tx, owner(), {
            projectId,
            columnId: seedIds.column(0, 1),
            title,
          }),
        ),
      ),
    );

    const numbers = results.map((result) =>
      isRefused(result) ? -1 : result.value.number,
    );

    expect(new Set(numbers).size).toBe(titles.length);
    expect(numbers).not.toContain(-1);
    expect([...numbers].sort((a, b) => a - b)).toStrictEqual([13, 14, 15, 16, 17, 18]);
  });

  it("refuses an empty title, and a viewer", async () => {
    const empty = await scoped((tx) =>
      createTask(tx, owner(), {
        projectId,
        columnId: seedIds.column(0, 1),
        title: "   ",
      }),
    );
    const byViewer = await scoped((tx) =>
      createTask(tx, viewer(), {
        projectId,
        columnId: seedIds.column(0, 1),
        title: "Qualquer coisa",
      }),
    );

    expect(isRefused(empty) && empty.reason).toBe("empty");
    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
  });

  it("stores the body the editor sent, without what it should not have sent", async () => {
    const result = await scoped((tx) =>
      updateTask(tx, owner(), {
        taskId: seedIds.task(1),
        body: '<p>Medir <strong>tudo</strong></p><script>steal()</script><p onclick="x()">e conferir</p>',
      }),
    );
    expect(isRefused(result)).toBe(false);

    const [row] = await connection.db
      .select({ body: tasks.body })
      .from(tasks)
      .where(eq(tasks.id, seedIds.task(1)));

    expect(row?.body).toContain("<strong>tudo</strong>");
    expect(row?.body).toContain("e conferir");
    expect(row?.body).not.toContain("script");
    expect(row?.body).not.toContain("onclick");
  });

  it("blocking and unblocking each leave one event, and their reason", async () => {
    const blocked = await scoped((tx) =>
      updateTask(tx, owner(), {
        taskId: seedIds.task(1),
        blocked: true,
        blockReason: "Esperando a tinta",
      }),
    );
    expect(isRefused(blocked)).toBe(false);

    const [afterBlock] = await connection.db
      .select({ blocked: tasks.blocked, reason: tasks.blockReason })
      .from(tasks)
      .where(eq(tasks.id, seedIds.task(1)));
    expect(afterBlock?.blocked).toBe(true);
    expect(afterBlock?.reason).toBe("Esperando a tinta");

    await scoped((tx) =>
      updateTask(tx, owner(), {
        taskId: seedIds.task(1),
        blocked: false,
      }),
    );

    const [afterUnblock] = await connection.db
      .select({ blocked: tasks.blocked, reason: tasks.blockReason })
      .from(tasks)
      .where(eq(tasks.id, seedIds.task(1)));
    expect(afterUnblock?.blocked).toBe(false);
    expect(afterUnblock?.reason).toBeNull();

    const events = await connection.db.select().from(outboxEvents);
    expect(events.map((event) => event.type)).toStrictEqual([
      "task.blocked",
      "task.unblocked",
    ]);
  });

  it("says nothing when a field is set to what it already was", async () => {
    await scoped((tx) =>
      updateTask(tx, owner(), {
        taskId: seedIds.task(1),
        blocked: false,
      }),
    );

    expect(await connection.db.select().from(outboxEvents)).toHaveLength(0);
  });

  it("announces a checklist only when its last item closes", async () => {
    const taskId = seedIds.task(3);

    const first = await scoped((tx) =>
      addChecklistItem(tx, owner(), {
        taskId,
        title: "Comprar",
      }),
    );
    const second = await scoped((tx) =>
      addChecklistItem(tx, owner(), {
        taskId,
        title: "Instalar",
      }),
    );
    if (isRefused(first) || isRefused(second)) throw new Error("expected two items");

    const one = await scoped((tx) =>
      setChecklistItem(tx, owner(), {
        itemId: first.value.itemId,
        done: true,
      }),
    );
    expect(isRefused(one) || one.value.checklistCompleted).toBe(false);
    expect(await connection.db.select().from(outboxEvents)).toHaveLength(0);

    const two = await scoped((tx) =>
      setChecklistItem(tx, owner(), {
        itemId: second.value.itemId,
        done: true,
      }),
    );
    expect(isRefused(two) || two.value.checklistCompleted).toBe(true);

    const events = await connection.db.select().from(outboxEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("checklist.completed");
  });

  it("refuses a dependency on itself, a duplicate, and one that closes a cycle", async () => {
    const a = seedIds.task(1);
    const b = seedIds.task(3);

    const itself = await scoped((tx) =>
      addDependency(tx, owner(), {
        taskId: a,
        dependsOnId: a,
      }),
    );
    expect(isRefused(itself) && itself.reason).toBe("self");

    const first = await scoped((tx) =>
      addDependency(tx, owner(), {
        taskId: a,
        dependsOnId: b,
      }),
    );
    expect(isRefused(first)).toBe(false);

    const again = await scoped((tx) =>
      addDependency(tx, owner(), {
        taskId: a,
        dependsOnId: b,
      }),
    );
    expect(isRefused(again) && again.reason).toBe("duplicate");

    // b -> a would close the loop a -> b -> a.
    const cycle = await scoped((tx) =>
      addDependency(tx, owner(), {
        taskId: b,
        dependsOnId: a,
      }),
    );
    expect(isRefused(cycle) && cycle.reason).toBe("cycle");

    if (isRefused(first)) throw new Error("expected a dependency");
    const removed = await scoped((tx) =>
      removeDependency(tx, owner(), first.value.dependencyId),
    );
    expect(isRefused(removed)).toBe(false);

    // With the edge gone, the other direction is allowed.
    const reversed = await scoped((tx) =>
      addDependency(tx, owner(), {
        taskId: b,
        dependsOnId: a,
      }),
    );
    expect(isRefused(reversed)).toBe(false);
  });

  it("refuses a dependency on a task in another project", async () => {
    const result = await scoped((tx) =>
      addDependency(tx, owner(), {
        taskId: seedIds.task(1),
        dependsOnId: seedIds.task(13),
      }),
    );

    expect(isRefused(result) && result.reason).toBe("not-found");
  });

  it("keeps a comment's text but not its script, and lets only its author edit it", async () => {
    const added = await scoped((tx) =>
      addComment(tx, owner(), {
        taskId: seedIds.task(1),
        body: "<p>Falei com o cliente</p><script>steal()</script>",
      }),
    );
    if (isRefused(added)) throw new Error(added.reason);

    const [row] = await connection.db
      .select({ body: taskComments.body })
      .from(taskComments)
      .where(eq(taskComments.id, added.value.commentId));
    expect(row?.body).toBe("<p>Falei com o cliente</p>");

    const somebodyElse = tenantContext(seedIds.workspace, seedIds.projects[1]!, "admin");
    const theirEdit = await scoped((tx) =>
      editComment(tx, somebodyElse, {
        commentId: added.value.commentId,
        body: "<p>Não foi isso</p>",
      }),
    );
    expect(isRefused(theirEdit) && theirEdit.reason).toBe("forbidden");

    const ownEdit = await scoped((tx) =>
      editComment(tx, owner(), {
        commentId: added.value.commentId,
        body: "<p>Falei com o cliente hoje</p>",
      }),
    );
    expect(isRefused(ownEdit)).toBe(false);
  });

  it("refuses an empty comment, whatever the editor wrapped it in", async () => {
    const result = await scoped((tx) =>
      addComment(tx, owner(), {
        taskId: seedIds.task(1),
        body: "<p></p><p>&nbsp;</p>",
      }),
    );

    expect(isRefused(result) && result.reason).toBe("empty");
  });

  it("lets whoever manages the project delete a comment they did not write", async () => {
    const first = await scoped((tx) =>
      addComment(tx, owner(), {
        taskId: seedIds.task(1),
        body: "<p>Anotação</p>",
      }),
    );
    const second = await scoped((tx) =>
      addComment(tx, owner(), {
        taskId: seedIds.task(1),
        body: "<p>Outra</p>",
      }),
    );
    if (isRefused(first) || isRefused(second)) throw new Error("expected two comments");

    // Somebody else, in each role that matters (§4.2.1).
    const somebody = seedIds.projects[1]!;
    const member = tenantContext(seedIds.workspace, somebody, "member");
    const manager = tenantContext(seedIds.workspace, somebody, "manager");
    const admin = tenantContext(seedIds.workspace, somebody, "admin");

    const byMember = await scoped((tx) =>
      removeComment(tx, member, first.value.commentId),
    );
    expect(isRefused(byMember) && byMember.reason).toBe("forbidden");

    const byManager = await scoped((tx) =>
      removeComment(tx, manager, first.value.commentId),
    );
    expect(isRefused(byManager)).toBe(false);

    const byAdmin = await scoped((tx) =>
      removeComment(tx, admin, second.value.commentId),
    );
    expect(isRefused(byAdmin)).toBe(false);
  });

  it("reads the whole document in one call", async () => {
    await scoped((tx) =>
      addComment(tx, owner(), {
        taskId: seedIds.task(5),
        body: "<p>Conferido</p>",
      }),
    );

    const document = await loadTaskDocument(connection.db, owner(), seedIds.task(5));
    expect(document).not.toBeNull();
    expect(document?.project.id).toBe(projectId);
    expect(document?.column.phase).toBeTruthy();
    expect(document?.comments).toHaveLength(1);
    // The seed makes TSK-5 wait on TSK-2.
    expect(document?.dependsOn.map((each) => each.number)).toStrictEqual([2]);
    expect(document?.blocks).toHaveLength(0);
  });

  it("does not read a task from another workspace", async () => {
    const stranger = tenantContext(seedIds.projects[1]!, seedIds.user, "owner");
    expect(await loadTaskDocument(connection.db, stranger, seedIds.task(1))).toBeNull();
  });
});
