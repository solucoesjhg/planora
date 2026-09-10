import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { outboxEvents, taskComments, tasks } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { loadTaskDocument } from "./repository";
import {
  addChecklistItem,
  addComment,
  addDependency,
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

  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const viewer = () => tenantContext(seedIds.workspace, seedIds.user, "viewer");
  const projectId = seedIds.projects[0]!;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  it("creates a task with the project's next number, at the end of its column", async () => {
    const column = seedIds.column(0, 1);

    const created = await createTask(connection.db, owner(), {
      projectId,
      columnId: column,
      title: "  Refazer o rodapé  ",
    });
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

  it("refuses an empty title, and a viewer", async () => {
    const empty = await createTask(connection.db, owner(), {
      projectId,
      columnId: seedIds.column(0, 1),
      title: "   ",
    });
    const byViewer = await createTask(connection.db, viewer(), {
      projectId,
      columnId: seedIds.column(0, 1),
      title: "Qualquer coisa",
    });

    expect(isRefused(empty) && empty.reason).toBe("empty");
    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
  });

  it("stores the body the editor sent, without what it should not have sent", async () => {
    const result = await updateTask(connection.db, owner(), {
      taskId: seedIds.task(1),
      body: '<p>Medir <strong>tudo</strong></p><script>steal()</script><p onclick="x()">e conferir</p>',
    });
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
    const blocked = await updateTask(connection.db, owner(), {
      taskId: seedIds.task(1),
      blocked: true,
      blockReason: "Esperando a tinta",
    });
    expect(isRefused(blocked)).toBe(false);

    const [afterBlock] = await connection.db
      .select({ blocked: tasks.blocked, reason: tasks.blockReason })
      .from(tasks)
      .where(eq(tasks.id, seedIds.task(1)));
    expect(afterBlock?.blocked).toBe(true);
    expect(afterBlock?.reason).toBe("Esperando a tinta");

    await updateTask(connection.db, owner(), {
      taskId: seedIds.task(1),
      blocked: false,
    });

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
    await updateTask(connection.db, owner(), {
      taskId: seedIds.task(1),
      blocked: false,
    });

    expect(await connection.db.select().from(outboxEvents)).toHaveLength(0);
  });

  it("announces a checklist only when its last item closes", async () => {
    const taskId = seedIds.task(3);

    const first = await addChecklistItem(connection.db, owner(), {
      taskId,
      title: "Comprar",
    });
    const second = await addChecklistItem(connection.db, owner(), {
      taskId,
      title: "Instalar",
    });
    if (isRefused(first) || isRefused(second)) throw new Error("expected two items");

    const one = await setChecklistItem(connection.db, owner(), {
      itemId: first.value.itemId,
      done: true,
    });
    expect(isRefused(one) || one.value.checklistCompleted).toBe(false);
    expect(await connection.db.select().from(outboxEvents)).toHaveLength(0);

    const two = await setChecklistItem(connection.db, owner(), {
      itemId: second.value.itemId,
      done: true,
    });
    expect(isRefused(two) || two.value.checklistCompleted).toBe(true);

    const events = await connection.db.select().from(outboxEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("checklist.completed");
  });

  it("refuses a dependency on itself, a duplicate, and one that closes a cycle", async () => {
    const a = seedIds.task(1);
    const b = seedIds.task(3);

    const itself = await addDependency(connection.db, owner(), {
      taskId: a,
      dependsOnId: a,
    });
    expect(isRefused(itself) && itself.reason).toBe("self");

    const first = await addDependency(connection.db, owner(), {
      taskId: a,
      dependsOnId: b,
    });
    expect(isRefused(first)).toBe(false);

    const again = await addDependency(connection.db, owner(), {
      taskId: a,
      dependsOnId: b,
    });
    expect(isRefused(again) && again.reason).toBe("duplicate");

    // b -> a would close the loop a -> b -> a.
    const cycle = await addDependency(connection.db, owner(), {
      taskId: b,
      dependsOnId: a,
    });
    expect(isRefused(cycle) && cycle.reason).toBe("cycle");

    if (isRefused(first)) throw new Error("expected a dependency");
    const removed = await removeDependency(
      connection.db,
      owner(),
      first.value.dependencyId,
    );
    expect(isRefused(removed)).toBe(false);

    // With the edge gone, the other direction is allowed.
    const reversed = await addDependency(connection.db, owner(), {
      taskId: b,
      dependsOnId: a,
    });
    expect(isRefused(reversed)).toBe(false);
  });

  it("refuses a dependency on a task in another project", async () => {
    const result = await addDependency(connection.db, owner(), {
      taskId: seedIds.task(1),
      dependsOnId: seedIds.task(13),
    });

    expect(isRefused(result) && result.reason).toBe("not-found");
  });

  it("keeps a comment's text but not its script, and lets only its author edit it", async () => {
    const added = await addComment(connection.db, owner(), {
      taskId: seedIds.task(1),
      body: "<p>Falei com o cliente</p><script>steal()</script>",
    });
    if (isRefused(added)) throw new Error(added.reason);

    const [row] = await connection.db
      .select({ body: taskComments.body })
      .from(taskComments)
      .where(eq(taskComments.id, added.value.commentId));
    expect(row?.body).toBe("<p>Falei com o cliente</p>");

    const somebodyElse = tenantContext(seedIds.workspace, seedIds.projects[1]!, "admin");
    const theirEdit = await editComment(connection.db, somebodyElse, {
      commentId: added.value.commentId,
      body: "<p>Não foi isso</p>",
    });
    expect(isRefused(theirEdit) && theirEdit.reason).toBe("forbidden");

    const ownEdit = await editComment(connection.db, owner(), {
      commentId: added.value.commentId,
      body: "<p>Falei com o cliente hoje</p>",
    });
    expect(isRefused(ownEdit)).toBe(false);
  });

  it("refuses an empty comment, whatever the editor wrapped it in", async () => {
    const result = await addComment(connection.db, owner(), {
      taskId: seedIds.task(1),
      body: "<p></p><p>&nbsp;</p>",
    });

    expect(isRefused(result) && result.reason).toBe("empty");
  });

  it("lets somebody who runs the workspace delete a comment they did not write", async () => {
    const added = await addComment(connection.db, owner(), {
      taskId: seedIds.task(1),
      body: "<p>Anotação</p>",
    });
    if (isRefused(added)) throw new Error(added.reason);

    const admin = tenantContext(seedIds.workspace, seedIds.projects[1]!, "admin");
    const member = tenantContext(seedIds.workspace, seedIds.projects[1]!, "member");

    const byMember = await removeComment(connection.db, member, added.value.commentId);
    expect(isRefused(byMember) && byMember.reason).toBe("forbidden");

    const byAdmin = await removeComment(connection.db, admin, added.value.commentId);
    expect(isRefused(byAdmin)).toBe(false);
  });

  it("reads the whole document in one call", async () => {
    await addComment(connection.db, owner(), {
      taskId: seedIds.task(5),
      body: "<p>Conferido</p>",
    });

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
