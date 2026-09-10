import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { boardColumns, clients, projects, tasks } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { listProjects } from "./repository";
import {
  completeProject,
  createProject,
  moveProject,
  reopenProject,
} from "./service";

const suite = describe.skipIf(!hasDatabase);

suite("projects", () => {
  let connection: Connection;
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

  it("gives a new project its four phases, one planning and one done", async () => {
    const created = await createProject(connection.db, owner(), {
      name: "Obra nova",
      clientName: "Construtora Sul",
    });
    if (isRefused(created)) throw new Error("expected a project");

    const columns = await connection.db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.projectId, created.value.projectId));

    expect(columns).toHaveLength(4);
    expect(columns.filter((column) => column.phase === "planning")).toHaveLength(1);
    expect(columns.filter((column) => column.phase === "done")).toHaveLength(1);
  });

  it("creates the client once, however many projects name it", async () => {
    await createProject(connection.db, owner(), {
      name: "Um",
      clientName: "Construtora Sul",
    });
    await createProject(connection.db, owner(), {
      name: "Dois",
      clientName: "  Construtora Sul  ",
    });

    const rows = await connection.db
      .select()
      .from(clients)
      .where(eq(clients.workspaceId, seedIds.workspace));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Construtora Sul");
  });

  it("refuses to finish a project that still has blocked work, and writes nothing", async () => {
    // The seed leaves TSK-2 blocked in the first project.
    const result = await completeProject(connection.db, owner(), {
      projectId: seedIds.projects[0],
    });

    expect(isRefused(result) && result.reason).toBe("blocked-tasks");

    const [row] = await connection.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, seedIds.projects[0]));
    expect(row?.status).toBe("active");
  });

  it("does not let the open-work acknowledgement cover blocked work", async () => {
    const forced = await completeProject(connection.db, owner(), {
      projectId: seedIds.projects[0],
      ack: "open-work",
    });

    expect(isRefused(forced) && forced.reason).toBe("blocked-tasks");
  });

  it("asks about open work, finishes when told to, and reopens", async () => {
    // A project of its own, with one open task and nothing blocked.
    const created = await createProject(connection.db, owner(), { name: "Curto" });
    if (isRefused(created)) throw new Error("expected a project");
    const projectId = created.value.projectId;

    const [planning] = await connection.db
      .select()
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.projectId, projectId),
          eq(boardColumns.phase, "planning"),
        ),
      );

    await connection.db.insert(tasks).values({
      workspaceId: seedIds.workspace,
      projectId,
      columnId: planning!.id,
      number: 1,
      title: "Sobrou isto",
      position: "V",
      createdBy: seedIds.user,
    });

    const asked = await completeProject(connection.db, owner(), { projectId });
    expect(isRefused(asked) && asked.reason).toBe("open-work");
    expect(isRefused(asked) && asked.detail).toBe("1");

    const forced = await completeProject(connection.db, owner(), {
      projectId,
      ack: "open-work",
    });
    expect(isRefused(forced)).toBe(false);

    const [completed] = await connection.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(completed?.status).toBe("completed");

    const reopened = await reopenProject(connection.db, owner(), projectId);
    expect(isRefused(reopened)).toBe(false);

    const [active] = await connection.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(active?.status).toBe("active");
  });

  it("reorders by writing one key between the new neighbours", async () => {
    const names = (list: { name: string }[]) => list.map((row) => row.name);

    const before = await listProjects(connection.db, owner());
    const [first, second] = before;
    expect(before).toHaveLength(2);

    const moved = await moveProject(connection.db, owner(), {
      projectId: second!.id,
      afterId: null,
      beforeId: first!.id,
    });
    expect(isRefused(moved)).toBe(false);

    const after = await listProjects(connection.db, owner());
    expect(names(after)).toStrictEqual([second!.name, first!.name]);
  });

  it("counts blocked work the way the domain does, dependencies included", async () => {
    const summaries = await listProjects(connection.db, owner());
    const first = summaries.find(
      (project) => project.id === seedIds.projects[0],
    );

    // TSK-2 carries the flag and TSK-5 waits on it: the grid counts both.
    expect(first?.blockedTasks).toBe(2);
    expect(first?.openTasks).toBeGreaterThan(0);
  });

  it("refuses a viewer, and a context from another workspace", async () => {
    const viewer = tenantContext(seedIds.workspace, seedIds.user, "viewer");
    const stranger = tenantContext(seedIds.projects[1], seedIds.user, "owner");

    const byViewer = await createProject(connection.db, viewer, { name: "Nada" });
    const byStranger = await completeProject(connection.db, stranger, {
      projectId: seedIds.projects[0],
    });

    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
    expect(isRefused(byStranger) && byStranger.reason).toBe("not-found");
  });
});
