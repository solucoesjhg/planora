import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { SEED_EPOCH, seed, seedIds } from "@/server/db/seed";
import { dispatchPending } from "@/server/events/dispatcher";
import { emit } from "@/server/events/outbox";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { latestActivity } from "@/server/modules/activity/repository";
import { loadDashboard } from "./view";

const suite = describe.skipIf(!hasDatabase);

/**
 * The dashboard is every project's board read at once. What this proves is
 * that the queries behind it run against real rows — the first production
 * build of Phase 8 found out the hard way that a page can pass every unit
 * test and still throw on its first request.
 */
suite("the dashboard", () => {
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

  it("reads every active project, counts the work by phase, and evaluates each one", async () => {
    const dashboard = await loadDashboard(connection.db, owner(), SEED_EPOCH);

    expect(dashboard.projects.map((project) => project.name)).toEqual([
      "Reforma do escritório",
      "Site institucional",
    ]);
    expect(dashboard.completedProjects).toBe(0);

    const counted = Object.values(dashboard.distribution).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(20);

    for (const project of dashboard.projects) {
      expect(project.verdict).not.toBe("insufficient_data");
      expect(project.progress.adjusted).toBeLessThanOrEqual(project.progress.raw);
      expect(project.trend).toEqual({ direction: "steady", days: 0 });
    }
    const verdictTotal = Object.values(dashboard.verdicts).reduce((sum, n) => sum + n, 0);
    expect(verdictTotal).toBe(2);
  });

  it("shows the newest activity as rows the feed can turn into sentences", async () => {
    const taskId = seedIds.task(1);
    await emit(connection.db, {
      workspaceId: seedIds.workspace,
      type: "task.moved",
      payload: {
        taskId,
        projectId: seedIds.projects[0],
        toColumnId: seedIds.column(0, 1),
        toPhase: "execution",
      },
      dedupeKey: "test:task.moved:1",
      actorId: seedIds.user,
    });
    await emit(connection.db, {
      workspaceId: seedIds.workspace,
      type: "member.invited",
      payload: { invitationId: "x", email: "ana@example.com", role: "member" },
      dedupeKey: "test:member.invited:1",
      actorId: seedIds.user,
    });
    await dispatchPending(connection.db);

    const entries = await latestActivity(connection.db, owner(), 10);
    const moved = entries.find((entry) => entry.verb === "task.moved");
    expect(moved).toMatchObject({
      actorName: "Henrique",
      taskNumber: 1,
      projectName: "Reforma do escritório",
      columnName: "Execução",
    });
    const invited = entries.find((entry) => entry.verb === "member.invited");
    expect(invited?.projectName).toBeNull();
    expect(invited?.taskNumber).toBeNull();
  });
});
