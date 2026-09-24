/**
 * Rules and their runs, as rows (DEVELOPMENT_PLAN.md §7 Phase 9).
 */

import { and, count, desc, eq, sql, sum } from "drizzle-orm";
import type { Action, Condition, Trigger } from "@/domain/automations";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor, Transaction } from "@/server/db/client";
import { automationRuns, automations, outboxEvents } from "@/server/db/schema";

export type AutomationRow = typeof automations.$inferSelect;
export type RunRow = typeof automationRuns.$inferSelect;

export type AutomationView = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: Trigger;
  readonly conditions: readonly Condition[];
  readonly actions: readonly Action[];
  readonly createdBy: string;
  readonly createdAt: Date;
};

export function toView(row: AutomationRow): AutomationView {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger as Trigger,
    conditions: (row.conditions ?? []) as Condition[],
    actions: (row.actions ?? []) as Action[],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function listAutomations(
  executor: Executor,
  context: TenantContext,
): Promise<AutomationView[]> {
  const rows = await executor
    .select()
    .from(automations)
    .where(eq(automations.workspaceId, context.workspaceId))
    .orderBy(desc(automations.createdAt));
  return rows.map(toView);
}

export async function findAutomation(
  executor: Executor,
  context: TenantContext,
  automationId: string,
): Promise<AutomationView | null> {
  const [row] = await executor
    .select()
    .from(automations)
    .where(and(eq(automations.workspaceId, context.workspaceId), eq(automations.id, automationId)))
    .limit(1);
  return row ? toView(row) : null;
}

/** The enabled rules waiting for this event, in a workspace. */
export async function rulesFor(
  executor: Executor,
  workspaceId: string,
  trigger: string,
): Promise<AutomationView[]> {
  const rows = await executor
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, workspaceId),
        eq(automations.trigger, trigger),
        eq(automations.enabled, true),
      ),
    )
    .orderBy(automations.createdAt);
  return rows.map(toView);
}

/** How many rules a workspace holds, enabled or not. */
export async function countAutomations(
  executor: Executor,
  context: TenantContext,
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(automations)
    .where(eq(automations.workspaceId, context.workspaceId));
  return row?.total ?? 0;
}

export async function insertAutomation(
  executor: Executor,
  context: TenantContext,
  input: {
    name: string;
    trigger: Trigger;
    conditions: readonly Condition[];
    actions: readonly Action[];
    enabled?: boolean;
  },
): Promise<string> {
  const [row] = await executor
    .insert(automations)
    .values({
      workspaceId: context.workspaceId,
      name: input.name,
      trigger: input.trigger,
      conditions: [...input.conditions],
      actions: [...input.actions],
      enabled: input.enabled ?? true,
      createdBy: context.userId,
    })
    .returning({ id: automations.id });
  return row!.id;
}

export async function updateAutomation(
  executor: Executor,
  context: TenantContext,
  automationId: string,
  values: Partial<{
    name: string;
    trigger: Trigger;
    conditions: readonly Condition[];
    actions: readonly Action[];
    enabled: boolean;
  }>,
): Promise<void> {
  await executor
    .update(automations)
    .set({
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.trigger === undefined ? {} : { trigger: values.trigger }),
      ...(values.conditions === undefined ? {} : { conditions: [...values.conditions] }),
      ...(values.actions === undefined ? {} : { actions: [...values.actions] }),
      ...(values.enabled === undefined ? {} : { enabled: values.enabled }),
      updatedAt: new Date(),
    })
    .where(and(eq(automations.workspaceId, context.workspaceId), eq(automations.id, automationId)));
}

export async function deleteAutomation(
  executor: Executor,
  context: TenantContext,
  automationId: string,
): Promise<void> {
  await executor
    .delete(automations)
    .where(and(eq(automations.workspaceId, context.workspaceId), eq(automations.id, automationId)));
}

/* ------------------------------------------------------------------ *
 * Runs — the idempotency, and the log
 * ------------------------------------------------------------------ */

/**
 * The act an event answers: up its `caused_by` links to the event a person or
 * the clock caused (ADR 0004). The depth guard stops rules at three, so this
 * walks at most that far; a link to an event that is gone ends the walk where
 * it is.
 */
export async function chainOf(
  executor: Executor,
  event: { readonly id: string; readonly causedBy: string | null },
): Promise<string> {
  let current = event;
  for (let step = 0; current.causedBy && step < 8; step += 1) {
    const [parent] = await executor
      .select({ id: outboxEvents.id, causedBy: outboxEvents.causedBy })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, current.causedBy))
      .limit(1);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/**
 * Holds one act's allowance until the transaction ends, so two dispatchers
 * reaching sibling events of the same act count one after the other rather
 * than both reading the same total.
 */
export async function lockChain(tx: Transaction, chainId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${chainId}, 0))`);
}

/** What every run of one act has been granted so far. */
export async function spentInChain(tx: Transaction, chainId: string): Promise<number> {
  const [row] = await tx
    .select({ spent: sum(automationRuns.actionsGranted).mapWith(Number) })
    .from(automationRuns)
    .where(eq(automationRuns.chainId, chainId));
  return row?.spent ?? 0;
}

/**
 * Claims the run for `(event, automation)`: the row is written before any
 * action, and the unique index refuses a second claim. `null` means somebody
 * — this process a moment ago, or a retry of the same event — already has it.
 */
export async function claimRun(
  executor: Executor,
  input: {
    workspaceId: string;
    automationId: string;
    eventId: string;
    chainId: string;
    actionsGranted: number;
  },
): Promise<string | null> {
  const [row] = await executor
    .insert(automationRuns)
    .values({
      workspaceId: input.workspaceId,
      automationId: input.automationId,
      eventId: input.eventId,
      chainId: input.chainId,
      actionsGranted: input.actionsGranted,
      status: "failed",
      detail: "interrupted before it finished",
    })
    .onConflictDoNothing({ target: [automationRuns.eventId, automationRuns.automationId] })
    .returning({ id: automationRuns.id });
  return row?.id ?? null;
}

export async function finishRun(
  executor: Executor,
  runId: string,
  outcome: { status: "succeeded" | "failed" | "skipped"; detail: string | null; actionsRun: number },
  now: Date = new Date(),
): Promise<void> {
  await executor
    .update(automationRuns)
    .set({
      status: outcome.status,
      detail: outcome.detail,
      actionsRun: outcome.actionsRun,
      finishedAt: now,
    })
    .where(eq(automationRuns.id, runId));
}

export type RunEntry = RunRow & { readonly automationName: string | null; readonly eventType: string | null };

/** The log a person reads: newest first, with the rule's name and the event. */
export async function listRuns(
  executor: Executor,
  context: TenantContext,
  limit = 30,
): Promise<RunEntry[]> {
  // Raw for the two left joins across modules; the runs table carries the tenant.
  const rows = await executor.execute(
    sql`
      select r.*, a.name as automation_name, e.type as event_type
        from automation_runs r
        left join automations a on a.id = r.automation_id
        left join outbox_events e on e.id = r.event_id
       where r.workspace_id = ${context.workspaceId}
       order by r.started_at desc, r.id desc
       limit ${limit}
    `,
  );

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    automationId: row["automation_id"] as string,
    eventId: row["event_id"] as string,
    chainId: row["chain_id"] as string,
    status: row["status"] as string,
    detail: (row["detail"] as string | null) ?? null,
    actionsGranted: row["actions_granted"] as number,
    actionsRun: row["actions_run"] as number,
    startedAt: new Date(row["started_at"] as string),
    finishedAt: row["finished_at"] ? new Date(row["finished_at"] as string) : null,
    automationName: (row["automation_name"] as string | null) ?? null,
    eventType: (row["event_type"] as string | null) ?? null,
  }));
}
