import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { MAX_ACTIONS_PER_ACT, MAX_RULES_PER_WORKSPACE } from "@/domain/automations";
import { newId } from "@/lib/id";
import { DAY_MS, calendarDateOf } from "@/domain/types";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import {
  activityLogs,
  automationRuns,
  notifications,
  outboxEvents,
  taskComments,
  tasks,
  users,
} from "@/server/db/schema";
import { SEED_EPOCH, seed, seedIds } from "@/server/db/seed";
import type { EmailSender } from "@/server/email/sender";
import { dispatchPending } from "@/server/events/dispatcher";
import { emit } from "@/server/events/outbox";
import { moveTask } from "@/server/modules/board/service";
import { deliverPendingEmails } from "@/server/modules/notifications/service";
import { addComment, createTask } from "@/server/modules/tasks/service";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import { insertAutomation, listRuns } from "./repository";
import { runRoutines } from "./routines";
import { createAutomation } from "./service";

const suite = describe.skipIf(!hasDatabase);

/**
 * The Phase 9 criteria: a rule fires from a real board event and the effect
 * is authored by the automation; a retried dispatch re-runs nothing; a
 * delivery failure retried three times leaves one run and one side effect;
 * and neither a chain of rules nor a long list of actions can run away.
 */
suite("automations", () => {
  let connection: Connection;
  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const taskId = seedIds.task(1);

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  /** Drains the outbox until nothing new appears — a chain of rules needs more than one pass. */
  async function drain(): Promise<void> {
    for (let pass = 0; pass < 10; pass += 1) {
      const result = await dispatchPending(connection.db);
      if (result.processed + result.failed === 0) return;
    }
  }

  const commentsOn = (id: string) =>
    connection.db.select().from(taskComments).where(eq(taskComments.taskId, id));
  const runs = () =>
    connection.db.select().from(automationRuns).where(eq(automationRuns.workspaceId, seedIds.workspace));

  it("fires from a real board event, and the effect is authored by the automation", async () => {
    const created = await createAutomation(connection.db, owner(), {
      name: "Boas-vindas à execução",
      trigger: "task.moved",
      conditions: [{ field: "to_phase", op: "is", value: "execution" }],
      actions: [{ type: "comment", body: "Chegou na execução." }],
    });
    if (isRefused(created)) throw new Error(created.reason);

    const moved = await moveTask(connection.db, owner(), {
      taskId,
      toColumnId: seedIds.column(0, 1),
    });
    if (isRefused(moved)) throw new Error(moved.reason);
    await drain();

    const comments = await commentsOn(taskId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Chegou na execução.");
    expect(comments[0]?.actorKind).toBe("automation");

    // The history says the product did it — never the person who owns the rule.
    const [entry] = await connection.db
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.verb, "comment.added"), eq(activityLogs.subjectId, taskId)));
    expect(entry?.actorKind).toBe("automation");
    expect(entry?.actorId).toBeNull();

    const log = await listRuns(connection.db, owner());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      status: "succeeded",
      actionsRun: 1,
      automationName: "Boas-vindas à execução",
      eventType: "task.moved",
    });

    // The consequence knows its cause, one step deep.
    const [caused] = await connection.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.type, "comment.added"));
    expect(caused?.depth).toBe(1);
    expect(caused?.causedBy).toBe(moved.value.eventId);
  });

  it("re-runs nothing when the same event is dispatched again", async () => {
    await createAutomation(connection.db, owner(), {
      name: "Eco",
      trigger: "task.moved",
      conditions: [],
      actions: [{ type: "comment", body: "Movida." }],
    });
    await moveTask(connection.db, owner(), { taskId, toColumnId: seedIds.column(0, 1) });
    await drain();
    expect(await commentsOn(taskId)).toHaveLength(1);

    // The delivery that "failed" after the action: the event comes back unprocessed.
    await connection.db
      .update(outboxEvents)
      .set({ processedAt: null })
      .where(eq(outboxEvents.type, "task.moved"));
    await drain();

    expect(await commentsOn(taskId)).toHaveLength(1);
    expect(await runs()).toHaveLength(1);
  });

  it("a delivery failure retried three times leaves one run and one side effect", async () => {
    await createAutomation(connection.db, owner(), {
      name: "Avisar o dono",
      trigger: "task.moved",
      conditions: [],
      actions: [{ type: "notify", to: "user", userId: seedIds.user, message: "Olhe esta tarefa." }],
    });
    await moveTask(connection.db, owner(), { taskId, toColumnId: seedIds.column(0, 1) });
    await drain();

    const sideEffects = () =>
      connection.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, "automation.notify"));
    expect(await sideEffects()).toHaveLength(1);
    expect((await sideEffects())[0]?.emailStatus).toBe("pending");

    let attempts = 0;
    const broken: EmailSender = {
      name: "broken",
      async send() {
        attempts += 1;
        throw new Error("smtp down");
      },
    };
    for (let round = 0; round < 3; round += 1) {
      await deliverPendingEmails(connection.db, broken, "http://localhost:3000");
    }
    // A fourth try has nothing left to try.
    await deliverPendingEmails(connection.db, broken, "http://localhost:3000");

    expect(attempts).toBe(3);
    const [effect] = await sideEffects();
    expect(effect?.emailAttempts).toBe(3);
    expect(effect?.emailStatus).toBe("failed");
    expect(effect?.emailError).toBe("smtp down");
    expect(await sideEffects()).toHaveLength(1);
    expect(await runs()).toHaveLength(1);
  });

  it("stops a rule that triggers itself at the depth limit, and says so in the log", async () => {
    await createAutomation(connection.db, owner(), {
      name: "Eco infinito",
      trigger: "comment.added",
      conditions: [],
      actions: [{ type: "comment", body: "eco" }],
    });

    const first = await addComment(connection.db, owner(), { taskId, body: "<p>olá</p>" });
    if (isRefused(first)) throw new Error(first.reason);
    await drain();

    // The person's comment, then three echoes: depths 1, 2 and 3. The fourth
    // would be depth 4, and the engine refuses at 3.
    expect(await commentsOn(taskId)).toHaveLength(4);
    const log = await runs();
    expect(log.filter((run) => run.status === "succeeded")).toHaveLength(3);
    const stopped = log.find((run) => run.status === "skipped");
    expect(stopped?.detail).toContain("laço");
  });

  it("fires at most ten actions for one event", async () => {
    // Written past the service, which would refuse twelve: a rule that
    // predates the cap, or was put there by hand. The engine still caps it.
    await insertAutomation(connection.db, owner(), {
      name: "Tagarela",
      trigger: "task.moved",
      conditions: [],
      actions: Array.from({ length: 12 }, (_, index) => ({
        type: "comment" as const,
        body: `#${index + 1}`,
      })),
    });
    await moveTask(connection.db, owner(), { taskId, toColumnId: seedIds.column(0, 1) });
    await drain();

    expect(await commentsOn(taskId)).toHaveLength(10);
    const [run] = await runs();
    expect(run?.actionsRun).toBe(10);
  });

  it("records a refused action in the run without stopping the others", async () => {
    // TSK-2 is the blocked one in the seed: Drop Catch refuses it into done.
    const blocked = seedIds.task(2);
    await createAutomation(connection.db, owner(), {
      name: "Empurra e comenta",
      trigger: "comment.added",
      conditions: [],
      actions: [
        { type: "move", phase: "done" },
        { type: "set_priority", priority: "high" },
      ],
    });
    await addComment(connection.db, owner(), { taskId: blocked, body: "<p>vai</p>" });
    await drain();

    const [run] = await runs();
    expect(run?.status).toBe("failed");
    expect(run?.actionsRun).toBe(1);
    expect(run?.detail).toContain("move:");

    const [row] = await connection.db.select().from(tasks).where(eq(tasks.id, blocked));
    expect(row?.priority).toBe("high");
    expect(row?.columnId).not.toBe(seedIds.column(0, 3));
  });

  it("refuses a rule that is not one, and a role that may not write rules", async () => {
    const empty = await createAutomation(connection.db, owner(), {
      name: "Vazia",
      trigger: "task.moved",
      conditions: [],
      actions: [],
    });
    expect(isRefused(empty) && empty.reason).toBe("invalid");

    const member = tenantContext(seedIds.workspace, seedIds.user, "member");
    const byMember = await createAutomation(connection.db, member, {
      name: "Sem permissão",
      trigger: "task.moved",
      conditions: [],
      actions: [{ type: "comment", body: "x" }],
    });
    expect(isRefused(byMember) && byMember.reason).toBe("forbidden");
  });

  /*
   * The audit of 2026-09-24 (ADR 0004). The ten-action cap was per rule, and a
   * workspace could hold any number of rules: ten rules of ten subtasks turned
   * one new task into a million by depth three, in the one outbox every
   * workspace shares. And `notify → user` reached any account in the
   * deployment, by email, from Planora's domain.
   */

  it("lets one act buy ten actions, however many rules answer it", async () => {
    for (const name of ["Primeira", "Segunda", "Terceira", "Quarta"]) {
      await createAutomation(connection.db, owner(), {
        name,
        trigger: "task.moved",
        conditions: [],
        actions: Array.from({ length: 4 }, (_, index) => ({
          type: "comment" as const,
          body: `${name} #${index + 1}`,
        })),
      });
    }
    await moveTask(connection.db, owner(), { taskId, toColumnId: seedIds.column(0, 1) });
    await drain();

    expect(await commentsOn(taskId)).toHaveLength(MAX_ACTIONS_PER_ACT);

    // Served in the order they were written: two whole, one cut short, one
    // skipped — and the log says why for the last two.
    const log = await connection.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.workspaceId, seedIds.workspace))
      .orderBy(automationRuns.startedAt);
    expect(log.map((run) => [run.actionsGranted, run.actionsRun, run.status])).toStrictEqual([
      [4, 4, "succeeded"],
      [4, 4, "succeeded"],
      [2, 2, "succeeded"],
      [0, 0, "skipped"],
    ]);
    expect(log[2]?.detail).toContain("2 de 4 ações");
    expect(log[3]?.detail).toContain("limite");
    // Every run answers the same act: the person's move.
    expect(new Set(log.map((run) => run.chainId)).size).toBe(1);
  });

  it("stops a cascade of subtasks at the act's allowance, however deep", async () => {
    await createAutomation(connection.db, owner(), {
      name: "Desdobra",
      trigger: "task.created",
      conditions: [],
      actions: Array.from({ length: 4 }, (_, index) => ({
        type: "create_subtask" as const,
        title: `Parte ${index + 1}`,
      })),
    });

    const created = await createTask(connection.db, owner(), {
      projectId: seedIds.projects[0],
      columnId: seedIds.column(0, 0),
      title: "Uma tarefa nova",
    });
    if (isRefused(created)) throw new Error(created.reason);
    await drain();

    // Before the allowance: 4 + 16 + 64 = 84 subtasks from one task.
    const subtasks = await connection.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, seedIds.workspace), isNotNull(tasks.parentTaskId)));
    expect(subtasks).toHaveLength(MAX_ACTIONS_PER_ACT);
  });

  it("refuses a rule past the workspace's allowance of rules", async () => {
    for (let index = 0; index < MAX_RULES_PER_WORKSPACE; index += 1) {
      await insertAutomation(connection.db, owner(), {
        name: `Regra ${index + 1}`,
        trigger: "task.moved",
        conditions: [],
        actions: [{ type: "comment", body: "x" }],
      });
    }

    const one = await createAutomation(connection.db, owner(), {
      name: "Uma a mais",
      trigger: "task.moved",
      conditions: [],
      actions: [{ type: "comment", body: "x" }],
    });
    expect(isRefused(one) && one.reason).toBe("too-many-rules");
  });

  describe("somebody outside the workspace", () => {
    const stranger = "55555555-5555-4555-8555-555555555555";

    beforeEach(async () => {
      await connection.db.insert(users).values({
        id: stranger,
        name: "Alguém de fora",
        email: "fora@example.com",
        emailVerified: true,
      });
    });

    const theirs = () =>
      connection.db.select().from(notifications).where(eq(notifications.userId, stranger));

    it("cannot be named by a rule", async () => {
      for (const action of [
        { type: "notify" as const, to: "user" as const, userId: stranger, message: "Oi" },
        { type: "assign" as const, userId: stranger },
      ]) {
        const written = await createAutomation(connection.db, owner(), {
          name: "Para fora",
          trigger: "task.moved",
          conditions: [],
          actions: [action],
        });
        expect(isRefused(written) && written.reason).toBe("not-a-member");
      }
    });

    it("is not told by a rule written before that was checked", async () => {
      await insertAutomation(connection.db, owner(), {
        name: "Planora Segurança: ação necessária",
        trigger: "task.moved",
        conditions: [],
        actions: [
          { type: "notify", to: "user", userId: stranger, message: "Sua conta será suspensa." },
        ],
      });
      await moveTask(connection.db, owner(), { taskId, toColumnId: seedIds.column(0, 1) });
      await drain();

      expect(await theirs()).toHaveLength(0);
      const [run] = await runs();
      expect(run?.status).toBe("failed");
      expect(run?.detail).toContain("ninguém para avisar");
    });

    it("is not told by an event that names them", async () => {
      // What the barrier admits: a row in the right workspace naming anybody.
      await emit(connection.db, {
        workspaceId: seedIds.workspace,
        type: "task.assigned",
        payload: { taskId, userIds: [stranger, seedIds.user] },
        dedupeKey: `forged:${newId()}`,
        actorKind: "automation",
      });
      await drain();

      expect(await theirs()).toHaveLength(0);
      const told = await connection.db
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(eq(notifications.type, "task.assigned"));
      expect(told.map((row) => row.userId)).toStrictEqual([seedIds.user]);
    });
  });
});

suite("the clock's routines", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
  });

  it("notices what is overdue, due soon and stalled, once per day", async () => {
    // The seed's overdue cards sit in done, where the clock does not look. Two
    // open cards get dates the clock should notice.
    const fiveDaysAgo = calendarDateOf(new Date(SEED_EPOCH.getTime() - 5 * DAY_MS));
    const tomorrow = calendarDateOf(new Date(SEED_EPOCH.getTime() + DAY_MS));
    await connection.db.update(tasks).set({ dueDate: fiveDaysAgo }).where(eq(tasks.id, seedIds.task(1)));
    await connection.db.update(tasks).set({ dueDate: tomorrow }).where(eq(tasks.id, seedIds.task(2)));

    const first = await runRoutines(connection.db, SEED_EPOCH);
    expect(first.overdue).toBe(1);
    expect(first.dueSoon).toBe(1);
    // Index 2 of each project entered review three weeks ago; review stales at five days.
    expect(first.stalled).toBe(2);
    expect(first.evaluated).toBe(2);

    const again = await runRoutines(connection.db, SEED_EPOCH);
    expect(again).toMatchObject({ overdue: 0, dueSoon: 0, stalled: 0 });

    const pending = await connection.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.type, "task.overdue"), isNull(outboxEvents.processedAt)));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.actorKind).toBe("automation");
    expect(pending[0]?.payload).toMatchObject({ taskId: seedIds.task(1), daysLate: 5 });
  });

  it("feeds the rules: an overdue task can raise its own priority", async () => {
    const owner = tenantContext(seedIds.workspace, seedIds.user, "owner");
    await createAutomation(connection.db, owner, {
      name: "Atrasada vira alta",
      trigger: "task.overdue",
      conditions: [{ field: "priority", op: "is_not", value: "high" }],
      actions: [{ type: "set_priority", priority: "high" }],
    });

    const fiveDaysAgo = calendarDateOf(new Date(SEED_EPOCH.getTime() - 5 * DAY_MS));
    await connection.db
      .update(tasks)
      .set({ dueDate: fiveDaysAgo, priority: "low" })
      .where(eq(tasks.id, seedIds.task(1)));

    await runRoutines(connection.db, SEED_EPOCH);
    await dispatchPending(connection.db);

    const overdue = await connection.db
      .select({ priority: tasks.priority })
      .from(tasks)
      .where(eq(tasks.id, seedIds.task(1)));
    expect(overdue[0]?.priority).toBe("high");
  });
});
