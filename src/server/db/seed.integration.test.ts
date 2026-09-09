import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import type { Connection } from "@/server/db/client";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { boardColumns, tasks } from "./schema";
import { seed, seedIds } from "./seed";

const suite = describe.skipIf(!hasDatabase);

suite("the seed", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  async function snapshot() {
    const [taskRows, columnRows] = await Promise.all([
      connection.db
        .select({
          id: tasks.id,
          columnId: tasks.columnId,
          number: tasks.number,
          position: tasks.position,
          blocked: tasks.blocked,
          dueDate: tasks.dueDate,
          enteredColumnAt: tasks.enteredColumnAt,
        })
        .from(tasks)
        .orderBy(asc(tasks.number)),
      connection.db
        .select({ id: boardColumns.id, phase: boardColumns.phase, position: boardColumns.position })
        .from(boardColumns)
        .orderBy(asc(boardColumns.position), asc(boardColumns.id)),
    ]);

    return { taskRows, columnRows };
  }

  it("rebuilds the identical state on every run", async () => {
    await seed(connection.db);
    const first = await snapshot();

    await seed(connection.db);
    const second = await snapshot();

    expect(second).toStrictEqual(first);
    expect(first.taskRows).toHaveLength(20);
  });

  it("gives every project exactly one planning and one done column", async () => {
    const result = await seed(connection.db);
    const rows = await connection.db.select().from(boardColumns);

    for (const projectId of result.projectIds) {
      const forProject = rows.filter((row) => row.projectId === projectId);
      expect(forProject.filter((row) => row.phase === "planning")).toHaveLength(1);
      expect(forProject.filter((row) => row.phase === "done")).toHaveLength(1);
    }
  });

  it("lets the database refuse a second planning column", async () => {
    await seed(connection.db);

    await expect(
      connection.db.insert(boardColumns).values({
        workspaceId: seedIds.workspace,
        projectId: seedIds.projects[0],
        name: "Outro planejamento",
        phase: "planning",
        position: "zz",
      }),
    ).rejects.toThrow();
  });

  it("refuses a task pointing at another workspace's project", async () => {
    const result = await seed(connection.db);

    await expect(
      connection.db.insert(tasks).values({
        workspaceId: "00000000-0000-7000-8000-000000000000",
        projectId: result.projectIds[0]!,
        columnId: seedIds.column(0, 0),
        number: 999,
        title: "Intruso",
        position: "zz",
        createdBy: result.userId,
      }),
    ).rejects.toThrow();
  });
});
