import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { asc, eq, isNotNull } from "drizzle-orm";
import type { Connection } from "@/server/db/client";
import { projects, tasks } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";

/**
 * The whole calendar-date fix rests on one assumption: a `date` column comes
 * back as `YYYY-MM-DD` and goes in the same way. If the driver ever starts
 * handing back a `Date` again, every deadline silently drifts by a day in any
 * zone west of UTC — so the assumption is pinned here rather than trusted.
 */
describe.skipIf(!hasDatabase)("calendar columns", () => {
  let connection: Connection;
  beforeAll(async () => { connection = await connectAndMigrate(); await seed(connection.db); });
  afterAll(async () => { await connection.close(); });

  it("comes back as YYYY-MM-DD, not as a Date", async () => {
    const [task] = await connection.db
      .select({ dueDate: tasks.dueDate }).from(tasks)
      .where(isNotNull(tasks.dueDate)).orderBy(asc(tasks.number)).limit(1);
    const [project] = await connection.db
      .select({ startDate: projects.startDate, dueDate: projects.dueDate })
      .from(projects).limit(1);

    expect(typeof task?.dueDate).toBe("string");
    expect(task?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof project?.startDate).toBe("string");
    expect(project?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("stores the day it was given, and reads back the same one", async () => {
    const [target] = await connection.db
      .select({ id: tasks.id }).from(tasks).orderBy(asc(tasks.number)).limit(1);

    await connection.db
      .update(tasks)
      .set({ dueDate: "2026-03-01" })
      .where(eq(tasks.id, target!.id));

    const [row] = await connection.db
      .select({ dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, target!.id));

    // Not 2026-02-28, which is what a round trip through midnight UTC gives.
    expect(row?.dueDate).toBe("2026-03-01");
  });
});
