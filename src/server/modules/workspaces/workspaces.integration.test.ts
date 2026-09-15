import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { attachments, projects, tasks, workspaceMembers, workspaces } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { loadWorkspaceExport, toCsv } from "./export";
import { deleteWorkspace } from "./service";

const suite = describe.skipIf(!hasDatabase);

suite("the Danger Zone and the export", () => {
  let connection: Connection;
  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const admin = () => tenantContext(seedIds.workspace, seedIds.user, "admin");

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  it("deletes the workspace and everything hanging off it, once the name is typed", async () => {
    const refusedName = await deleteWorkspace(connection.db, owner(), "Outro nome");
    expect(isRefused(refusedName) && refusedName.reason).toBe("mismatch");
    expect(await connection.db.select().from(workspaces)).toHaveLength(1);

    const deleted = await deleteWorkspace(connection.db, owner(), "  Planora ");
    expect(isRefused(deleted)).toBe(false);

    expect(await connection.db.select().from(workspaces)).toHaveLength(0);
    expect(await connection.db.select().from(workspaceMembers)).toHaveLength(0);
    expect(
      await connection.db.select().from(projects).where(eq(projects.workspaceId, seedIds.workspace)),
    ).toHaveLength(0);
    expect(
      await connection.db.select().from(tasks).where(eq(tasks.workspaceId, seedIds.workspace)),
    ).toHaveLength(0);
    expect(await connection.db.select().from(attachments)).toHaveLength(0);
  });

  it("is the owner's alone", async () => {
    const byAdmin = await deleteWorkspace(connection.db, admin(), "Planora");
    expect(isRefused(byAdmin) && byAdmin.reason).toBe("forbidden");
    expect(await connection.db.select().from(workspaces)).toHaveLength(1);
  });

  it("exports every project with its tasks, and one CSV row per task", async () => {
    const data = await loadWorkspaceExport(connection.db, owner());
    if (!data) throw new Error("the seed workspace exists");

    expect(data.workspace.name).toBe("Planora");
    expect(data.projects.map((project) => project.name)).toEqual([
      "Reforma do escritório",
      "Site institucional",
    ]);
    const taskCount = data.projects.reduce((sum, project) => sum + project.tasks.length, 0);
    expect(taskCount).toBe(20);

    // The dependency chain the seed writes comes out as numbers, not ids.
    const waiting = data.projects
      .flatMap((project) => project.tasks)
      .find((task) => task.dependsOn.length > 0);
    expect(waiting?.dependsOn).toEqual([2]);

    const rows = toCsv(data).split("\r\n").filter(Boolean);
    expect(rows).toHaveLength(1 + taskCount);
  });
});
