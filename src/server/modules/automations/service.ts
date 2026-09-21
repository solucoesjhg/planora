/**
 * Running rules (DEVELOPMENT_PLAN.md §7 Phase 9).
 *
 * The engine in `domain/automations` decides; this module performs, through
 * the same services a person's click goes through — with a context that
 * signs as `automation` (§4.6) and carries the causing event, so every
 * consequence is traceable and a chain of rules is counted, not hidden.
 *
 * One run per `(event, automation)`: the row is claimed before any action and
 * the unique index refuses a second claim, so a retried dispatch re-runs
 * nothing. Actions that are refused — a move Drop Catch bounces, a person who
 * is not a member — fail that action, are written into the run's detail, and
 * do not stop the others.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  MAX_CAUSATION_DEPTH,
  evaluateRule,
  validateRule,
  type Action,
  type Condition,
  type Subject,
  type Trigger,
} from "@/domain/automations";
import { type Phase, type Priority, calendarDateOf } from "@/domain/types";
import { channelsFor } from "@/lib/notifications";
import { isRefused, ok, refused, type Result } from "@/lib/result";
import { PHASE_LABELS } from "@/lib/strings";
import { can, type TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { boardColumns, outboxEvents, taskAssignees, tasks, workspaceMembers } from "@/server/db/schema";
import { moveTask } from "@/server/modules/board/service";
import { insertNotifications, preferencesOf } from "@/server/modules/notifications/repository";
import { addComment, assignTask, createTask, updateTask } from "@/server/modules/tasks/service";
import {
  claimRun,
  deleteAutomation as deleteRow,
  findAutomation,
  finishRun,
  insertAutomation,
  rulesFor,
  updateAutomation as updateRow,
  type AutomationView,
} from "./repository";

type EventRow = typeof outboxEvents.$inferSelect;

export type AutomationFailure = "forbidden" | "not-found" | "invalid";

export type AutomationInput = {
  readonly name: string;
  readonly trigger: Trigger;
  readonly conditions: readonly Condition[];
  readonly actions: readonly Action[];
  readonly enabled?: boolean;
};

const NAME_LIMIT = 120;

/* ------------------------------------------------------------------ *
 * Writing rules
 * ------------------------------------------------------------------ */

export async function createAutomation(
  db: Executor,
  context: TenantContext,
  input: AutomationInput,
): Promise<Result<{ automationId: string }, AutomationFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_LIMIT) return refused("invalid", "name");
  const problems = validateRule(input);
  if (problems.length > 0) return refused("invalid", problems.join(", "));

  const automationId = await insertAutomation(db, context, { ...input, name });
  return ok({ automationId });
}

export async function updateAutomation(
  db: Executor,
  context: TenantContext,
  automationId: string,
  values: Partial<AutomationInput>,
): Promise<Result<{ automationId: string }, AutomationFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);

  const current = await findAutomation(db, context, automationId);
  if (!current) return refused("not-found", automationId);

  const merged = { ...current, ...values };
  const name = merged.name.trim();
  if (name.length === 0 || name.length > NAME_LIMIT) return refused("invalid", "name");
  const problems = validateRule(merged);
  if (problems.length > 0) return refused("invalid", problems.join(", "));

  await updateRow(db, context, automationId, { ...values, name });
  return ok({ automationId });
}

export async function deleteAutomation(
  db: Executor,
  context: TenantContext,
  automationId: string,
): Promise<Result<{ automationId: string }, AutomationFailure>> {
  if (!can(context, "manage-project")) return refused("forbidden", context.role);
  const current = await findAutomation(db, context, automationId);
  if (!current) return refused("not-found", automationId);

  await deleteRow(db, context, automationId);
  return ok({ automationId });
}

/* ------------------------------------------------------------------ *
 * Running them
 * ------------------------------------------------------------------ */

export type RunSummary = { readonly fired: number; readonly skipped: number };

/**
 * Every rule waiting on one event.
 *
 * The executor is the dispatcher's, which drains the outbox across every
 * workspace by design and therefore runs on the system lane (ADR 0002). The
 * services each action goes through take it as the `Executor` they already
 * accepted, so nothing below here opens a pool of its own.
 */
export async function runAutomationsFor(
  db: Executor,
  event: EventRow,
  now: Date = new Date(),
): Promise<RunSummary> {
  const rules = await rulesFor(db, event.workspaceId, event.type);
  if (rules.length === 0) return { fired: 0, skipped: 0 };

  const subject = await subjectFor(db, event);
  const today = calendarDateOf(now);
  let fired = 0;
  let skipped = 0;

  for (const rule of rules) {
    const verdict = evaluateRule(rule, { type: event.type, depth: event.depth }, subject, today);

    if (verdict.kind === "skip") {
      skipped += 1;
      // A guard that fired is worth a line in the log; a condition that simply
      // did not hold is not.
      if (verdict.reason === "loop") {
        const runId = await claimRun(db, { workspaceId: event.workspaceId, automationId: rule.id, eventId: event.id });
        if (runId) {
          await finishRun(db, runId, {
            status: "skipped",
            detail: `laço: este evento já é consequência de ${event.depth} automações (limite ${MAX_CAUSATION_DEPTH})`,
            actionsRun: 0,
          }, now);
        }
      }
      continue;
    }

    const runId = await claimRun(db, { workspaceId: event.workspaceId, automationId: rule.id, eventId: event.id });
    if (!runId) continue; // already ran, or running: a retry re-runs nothing

    const context: TenantContext = {
      workspaceId: event.workspaceId,
      userId: rule.createdBy,
      role: "manager",
      actor: { kind: "automation", causedBy: event.id, depth: event.depth + 1 },
    };

    const failures: string[] = [];
    let actionsRun = 0;
    for (const action of verdict.actions) {
      try {
        await perform(db, context, rule, runId, action, subject, event);
        actionsRun += 1;
      } catch (error) {
        failures.push(`${action.type}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await finishRun(db, runId, {
      status: failures.length === 0 ? "succeeded" : "failed",
      detail: failures.length === 0 ? null : failures.join(" · "),
      actionsRun,
    }, now);
    fired += 1;
  }

  return { fired, skipped };
}

type TaskFacts = {
  readonly id: string;
  readonly projectId: string;
  readonly columnId: string;
  readonly createdBy: string;
  readonly assigneeIds: readonly string[];
};

/** What the engine may ask, plus what the actions need to find their way. */
async function subjectFor(
  executor: Executor,
  event: EventRow,
): Promise<Subject & { readonly facts: TaskFacts | null }> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const taskId = typeof payload["taskId"] === "string" ? payload["taskId"] : null;
  const toPhase = typeof payload["toPhase"] === "string" ? (payload["toPhase"] as Phase) : undefined;
  const verdict = typeof payload["to"] === "string" ? (payload["to"] as Subject["verdict"]) : undefined;

  if (!taskId) return { facts: null, ...(toPhase ? { toPhase } : {}), ...(verdict ? { verdict } : {}) };

  const [row] = await executor
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      columnId: tasks.columnId,
      priority: tasks.priority,
      blocked: tasks.blocked,
      dueDate: tasks.dueDate,
      createdBy: tasks.createdBy,
      phase: boardColumns.phase,
    })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(and(eq(tasks.workspaceId, event.workspaceId), eq(tasks.id, taskId)))
    .limit(1);
  if (!row) return { facts: null, ...(toPhase ? { toPhase } : {}), ...(verdict ? { verdict } : {}) };

  const assignees = await executor
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.workspaceId, event.workspaceId), eq(taskAssignees.taskId, taskId)));
  const assigneeIds = assignees.map((each) => each.userId);

  return {
    task: {
      priority: row.priority as Priority,
      phase: row.phase as Phase,
      blocked: row.blocked,
      assigneeIds,
      dueDate: row.dueDate,
    },
    ...(toPhase ? { toPhase } : {}),
    ...(verdict ? { verdict } : {}),
    facts: { id: row.id, projectId: row.projectId, columnId: row.columnId, createdBy: row.createdBy, assigneeIds },
  };
}

async function perform(
  db: Executor,
  context: TenantContext,
  rule: AutomationView,
  runId: string,
  action: Action,
  subject: Subject & { readonly facts: TaskFacts | null },
  event: EventRow,
): Promise<void> {
  const task = subject.facts;
  const needsTask = (): TaskFacts => {
    if (!task) throw new Error("o evento não tem tarefa");
    return task;
  };

  switch (action.type) {
    case "assign": {
      const facts = needsTask();
      const result = await assignTask(db, context, {
        taskId: facts.id,
        userIds: [...new Set([...facts.assigneeIds, action.userId])],
      });
      if (isRefused(result)) throw new Error(result.reason);
      return;
    }
    case "move": {
      const facts = needsTask();
      const [column] = await db
        .select({ id: boardColumns.id })
        .from(boardColumns)
        .where(
          and(
            eq(boardColumns.workspaceId, context.workspaceId),
            eq(boardColumns.projectId, facts.projectId),
            eq(boardColumns.phase, action.phase),
          ),
        )
        .orderBy(boardColumns.position)
        .limit(1);
      if (!column) throw new Error(`nenhuma coluna de ${PHASE_LABELS[action.phase]}`);
      if (column.id === facts.columnId) return; // already there
      const result = await moveTask(db, context, {
        taskId: facts.id,
        toColumnId: column.id,
        phaseLabel: (phase) => PHASE_LABELS[phase],
      });
      if (isRefused(result)) throw new Error(result.reason);
      return;
    }
    case "comment": {
      const facts = needsTask();
      const result = await addComment(db, context, {
        taskId: facts.id,
        body: `<p>${escapeHtml(action.body)}</p>`,
      });
      if (isRefused(result)) throw new Error(result.reason);
      return;
    }
    case "create_subtask": {
      const facts = needsTask();
      const result = await createTask(db, context, {
        projectId: facts.projectId,
        columnId: facts.columnId,
        title: action.title,
        parentTaskId: facts.id,
      });
      if (isRefused(result)) throw new Error(result.reason);
      return;
    }
    case "set_priority": {
      const facts = needsTask();
      const result = await updateTask(db, context, { taskId: facts.id, priority: action.priority });
      if (isRefused(result)) throw new Error(result.reason);
      return;
    }
    case "notify": {
      const recipients =
        action.to === "user"
          ? action.userId
            ? [action.userId]
            : []
          : action.to === "assignees"
            ? (task?.assigneeIds ?? [])
            : (
                await db
                  .select({ userId: workspaceMembers.userId })
                  .from(workspaceMembers)
                  .where(
                    and(
                      eq(workspaceMembers.workspaceId, context.workspaceId),
                      inArray(workspaceMembers.role, ["owner", "admin", "manager"]),
                    ),
                  )
              ).map((row) => row.userId);
      if (recipients.length === 0) throw new Error("ninguém para avisar");

      const preferences = await preferencesOf(db, context.workspaceId, recipients);
      const href = task
        ? `/projects/${task.projectId}/tasks/${task.id}`
        : typeof (event.payload as Record<string, unknown>)["projectId"] === "string"
          ? `/projects/${(event.payload as Record<string, unknown>)["projectId"] as string}`
          : null;

      await insertNotifications(
        db,
        recipients.map((userId) => ({
          workspaceId: context.workspaceId,
          userId,
          // The run stands in for the event: one row per person per run.
          eventId: runId,
          type: "automation.notify",
          title: `Automação: ${rule.name}`,
          body: action.message,
          href,
          email: channelsFor("automation.notify", preferences.get(userId)?.channels).email,
        })),
      );
      return;
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
