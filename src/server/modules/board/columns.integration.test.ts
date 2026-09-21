import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection, Transaction } from "@/server/db/client";
import { boardColumns, tasks } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { createColumn, deleteColumn, moveColumn, renameColumn } from "./columns";

const suite = describe.skipIf(!hasDatabase);

suite("columns", () => {
  let connection: Connection;

  /**
   * The scope a Server Action opens in production (ADR 0002). The suite holds a
   * connection of its own, not the pool `withTenant` reaches for, so it opens
   * the scope itself and hands the service the transaction — which is what the
   * services now expect to be given.
   */
  const scoped = <T>(run: (tx: Transaction) => Promise<T>): Promise<T> =>
    connection.db.transaction(run);

  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const projectId = seedIds.projects[0];

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  const columnsOf = async () =>
    connection.db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))
      .orderBy(asc(boardColumns.position), asc(boardColumns.id));

  it("puts a new column beside the others of its phase", async () => {
    const created = await scoped((tx) =>
      createColumn(tx, owner(), {
        projectId,
        name: "Testes",
        phase: "execution",
      }),
    );
    expect(isRefused(created)).toBe(false);

    const phases = (await columnsOf()).map((column) => column.phase);
    // planning · execution · execution · review · done — the board still reads
    // left to right.
    expect(phases).toStrictEqual([
      "planning",
      "execution",
      "execution",
      "review",
      "done",
    ]);
  });

  it("refuses a second planning or done column", async () => {
    for (const phase of ["planning", "done"] as const) {
      const result = await scoped((tx) =>
        createColumn(tx, owner(), {
          projectId,
          name: "Outra",
          phase: phase as "execution",
        }),
      );
      expect(isRefused(result) && result.reason).toBe("phase-taken");
    }
  });

  it("renames any column, including the fixed ones", async () => {
    const [planning] = (await columnsOf()).filter(
      (column) => column.phase === "planning",
    );

    const result = await scoped((tx) =>
      renameColumn(tx, owner(), {
        columnId: planning!.id,
        name: "A fazer",
      }),
    );
    expect(isRefused(result)).toBe(false);

    const [renamed] = (await columnsOf()).filter(
      (column) => column.id === planning!.id,
    );
    expect(renamed?.name).toBe("A fazer");
    expect(renamed?.phase).toBe("planning");
  });

  it("refuses to delete or reorder planning and done", async () => {
    const columns = await columnsOf();
    const planning = columns.find((column) => column.phase === "planning")!;
    const done = columns.find((column) => column.phase === "done")!;

    const deleted = await scoped((tx) => deleteColumn(tx, owner(), done.id));
    const moved = await scoped((tx) =>
      moveColumn(tx, owner(), {
        columnId: planning.id,
        afterId: done.id,
      }),
    );

    expect(isRefused(deleted) && deleted.reason).toBe("immutable-column");
    expect(isRefused(moved) && moved.reason).toBe("immutable-column");
    expect(await columnsOf()).toHaveLength(4);
  });

  it("refuses to delete a column that still holds cards", async () => {
    const execution = (await columnsOf()).find(
      (column) => column.phase === "execution",
    )!;

    const result = await scoped((tx) => deleteColumn(tx, owner(), execution.id));
    expect(isRefused(result) && result.reason).toBe("not-empty");
  });

  it("deletes an empty middle column", async () => {
    const created = await scoped((tx) =>
      createColumn(tx, owner(), {
        projectId,
        name: "Testes",
        phase: "review",
      }),
    );
    if (isRefused(created)) throw new Error("expected a column");

    const result = await scoped((tx) =>
      deleteColumn(tx, owner(), created.value.columnId),
    );
    expect(isRefused(result)).toBe(false);
    expect(await columnsOf()).toHaveLength(4);
  });

  it("reorders a middle column without disturbing the ends", async () => {
    const created = await scoped((tx) =>
      createColumn(tx, owner(), {
        projectId,
        name: "Testes",
        phase: "review",
      }),
    );
    if (isRefused(created)) throw new Error("expected a column");

    const columns = await columnsOf();
    const execution = columns.find((column) => column.phase === "execution")!;
    const planning = columns.find((column) => column.phase === "planning")!;

    const moved = await scoped((tx) =>
      moveColumn(tx, owner(), {
        columnId: created.value.columnId,
        afterId: planning.id,
        beforeId: execution.id,
      }),
    );
    expect(isRefused(moved)).toBe(false);

    const names = (await columnsOf()).map((column) => column.name);
    expect(names[0]).toBe("Planejamento");
    expect(names[1]).toBe("Testes");
    expect(names.at(-1)).toBe("Concluído");
  });

  it("refuses a member who cannot manage columns", async () => {
    const member = tenantContext(seedIds.workspace, seedIds.user, "member");

    const result = await scoped((tx) =>
      createColumn(tx, member, {
        projectId,
        name: "Testes",
        phase: "execution",
      }),
    );

    expect(isRefused(result) && result.reason).toBe("forbidden");
  });

  it("keeps every task attached to a column that still exists", async () => {
    // A guard against a delete that would orphan cards.
    const rows = await connection.db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, seedIds.workspace), eq(tasks.projectId, projectId)),
      );

    const ids = new Set((await columnsOf()).map((column) => column.id));
    for (const row of rows) expect(ids.has(row.columnId)).toBe(true);
  });
});
