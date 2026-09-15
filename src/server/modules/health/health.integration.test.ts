import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { calendarDateOf, DAY_MS } from "@/domain/types";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { outboxEvents, projectHealthSnapshots, projects } from "@/server/db/schema";
import { SEED_EPOCH, seed, seedIds } from "@/server/db/seed";
import { loadBoardContext } from "@/server/modules/board/repository";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { writeSnapshot } from "./repository";
import { evaluateProjectHealth } from "./service";

const suite = describe.skipIf(!hasDatabase);

/**
 * The service around the engine: one row per project per day, yesterday's
 * row as the previous evaluation, an event only when the verdict moves, and a
 * trend read from the rows that accumulate.
 */
suite("project health, evaluated on read", () => {
  let connection: Connection;
  const context = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const projectId = seedIds.projects[0]!;
  const now = SEED_EPOCH;
  const daysAgo = (days: number) => calendarDateOf(new Date(now.getTime() - days * DAY_MS));

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  async function evaluate(at = now) {
    const [row] = await connection.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    const board = await loadBoardContext(connection.db, context(), projectId);
    return evaluateProjectHealth(connection.db, context(), row!, board, at);
  }

  const snapshotRows = () =>
    connection.db
      .select()
      .from(projectHealthSnapshots)
      .where(eq(projectHealthSnapshots.projectId, projectId));

  it("writes today's row once, and rewrites it on a second read", async () => {
    const first = await evaluate();
    expect(first.report.verdict).not.toBe("insufficient_data");
    expect(first.changed).toBe(false);

    const second = await evaluate();
    expect(second.report.score).toBe(first.report.score);

    const rows = await snapshotRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe(calendarDateOf(now));
    expect(rows[0]?.verdict).toBe(first.report.verdict);
    expect(rows[0]?.flow).toBe(first.report.dimensions.flow);
  });

  it("defends yesterday's verdict, and says so once when it moves", async () => {
    const today = await evaluate();
    // The seed project carries a blocked chain, two overdue and two stale
    // tasks: it is not healthy. If that ever changes, this test must too.
    expect(today.report.verdict).not.toBe("healthy");

    // Yesterday it was, comfortably: the boundary is crossed by far more than
    // the margin, so the verdict moves on the first evaluation.
    await writeSnapshot(connection.db, context(), projectId, daysAgo(1), {
      score: 96,
      verdict: "healthy",
      rawVerdict: "healthy",
      dimensions: { flow: 100, pace: 95, punctuality: 100, freshness: 90, momentum: 100 },
    });

    const moved = await evaluate();
    expect(moved.changed).toBe(true);
    expect(moved.report.verdict).toBe(today.report.verdict);

    const events = () =>
      connection.db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.workspaceId, seedIds.workspace),
            eq(outboxEvents.type, "project.health_changed"),
          ),
        );

    const [event] = await events();
    expect(event?.payload).toMatchObject({
      projectId,
      from: "healthy",
      to: moved.report.verdict,
    });
    // Nobody signs a verdict.
    expect(event?.actorKind).toBe("automation");
    expect(event?.actorId).toBeNull();

    // Read again the same day: the same change is not announced twice.
    const again = await evaluate();
    expect(again.changed).toBe(true);
    expect(await events()).toHaveLength(1);
  });

  it("reads the trend from the rows that accumulate", async () => {
    const today = await evaluate();
    const score = today.report.score;
    if (score === null) throw new Error("the seed project has a score");

    // Three earlier days, each a little better than the next: a fall of three
    // days ending today. The verdict is kept, so hysteresis has nothing to say.
    for (const [offset, lift] of [
      [3, 3],
      [2, 2],
      [1, 1],
    ] as const) {
      await writeSnapshot(connection.db, context(), projectId, daysAgo(offset), {
        score: Math.min(100, score + lift),
        verdict: today.report.verdict,
        rawVerdict: today.report.rawVerdict,
        dimensions: today.report.dimensions,
      });
    }

    const evaluated = await evaluate();
    expect(evaluated.trend).toEqual({ direction: "worsening", days: 3 });
    expect(evaluated.history).toHaveLength(4);
  });

  it("shows four dimensions for a project with no dates, not a fabricated fifth", async () => {
    await connection.db
      .update(projects)
      .set({ startDate: null, dueDate: null })
      .where(eq(projects.id, projectId));

    const { report } = await evaluate();
    expect(report.dimensions.pace).toBeNull();
    const computed = Object.values(report.dimensions).filter((value) => value !== null);
    expect(computed).toHaveLength(4);
  });
});
