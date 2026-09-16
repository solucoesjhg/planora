/**
 * The outbox dispatcher (DEVELOPMENT_PLAN.md §4.5, §4.6, §7 Phase 9).
 *
 * Reads events nobody has consumed yet and hands them to three consumers,
 * each idempotent on the event's id: the activity feed (one line per event),
 * the notifications (one inbox row per person per event) and the automations
 * (one run per rule per event). A dispatch that fails halfway is retried on
 * the next tick and repeats nothing; after MAX_ATTEMPTS the event is marked
 * processed with its last error, so a poisoned row cannot hold the queue.
 *
 * An action taken by a rule is recorded as `automation`, never as the person
 * who happens to own the workspace.
 */

import { asc, eq, isNull } from "drizzle-orm";
import type { Database, Executor } from "@/server/db/client";
import { activityLogs, outboxEvents } from "@/server/db/schema";
import { runAutomationsFor } from "@/server/modules/automations/service";
import { notifyFor } from "@/server/modules/notifications/service";
import type { EventType } from "./outbox";

type EventRow = typeof outboxEvents.$inferSelect;

export type DispatchResult = {
  readonly processed: number;
  readonly failed: number;
  /** Events that failed for the last time and were set aside. */
  readonly abandoned: number;
};

/** A third failure is the last: the event is set aside with its error. */
export const MAX_ATTEMPTS = 3;

const SUBJECT_OF: Record<EventType, string> = {
  "project.created": "project",
  "project.completed": "project",
  "project.reopened": "project",
  "task.created": "task",
  "task.moved": "task",
  "task.blocked": "task",
  "task.unblocked": "task",
  "task.completed": "task",
  "task.assigned": "task",
  "checklist.completed": "task",
  "comment.added": "task",
  "dependency.resolved": "task",
  "project.health_changed": "project",
  "member.invited": "workspace",
  "task.due_soon": "task",
  "task.overdue": "task",
  "task.stalled": "task",
};

export async function dispatchPending(
  db: Database,
  options: { limit?: number } = {},
): Promise<DispatchResult> {
  const pending = await db
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.processedAt))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(options.limit ?? 100);

  let processed = 0;
  let failed = 0;
  let abandoned = 0;

  for (const event of pending) {
    try {
      await db.transaction(async (tx) => {
        await recordActivity(tx, event);
        await notifyFor(tx, event);
      });
      // Rules act through the services, each in its own transaction; the run
      // row they claim first is what makes a retry re-run nothing.
      await runAutomationsFor(db, event);
      await db
        .update(outboxEvents)
        .set({ processedAt: new Date(), lastError: null })
        .where(eq(outboxEvents.id, event.id));
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = event.attempts + 1;
      const givingUp = attempts >= MAX_ATTEMPTS;
      if (givingUp) abandoned += 1;
      await db
        .update(outboxEvents)
        .set({
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          ...(givingUp ? { processedAt: new Date() } : {}),
        })
        .where(eq(outboxEvents.id, event.id));
    }
  }

  return { processed, failed, abandoned };
}

/**
 * Dispatches until nothing new appears — bounded, because a rule's action
 * emits events of its own and those deserve the same tick. The depth guard
 * in the engine is what keeps the bound from being reached by a loop.
 */
export async function drainOutbox(
  db: Database,
  options: { limit?: number; passes?: number } = {},
): Promise<DispatchResult> {
  const total = { processed: 0, failed: 0, abandoned: 0 };
  const passes = options.passes ?? 6;

  for (let pass = 0; pass < passes; pass += 1) {
    const result = await dispatchPending(db, options);
    total.processed += result.processed;
    total.failed += result.failed;
    total.abandoned += result.abandoned;
    if (result.processed === 0) break;
  }

  return total;
}

async function recordActivity(executor: Executor, event: EventRow): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const subjectId =
    typeof payload["taskId"] === "string"
      ? payload["taskId"]
      : typeof payload["projectId"] === "string"
        ? payload["projectId"]
        : event.workspaceId;

  await executor
    .insert(activityLogs)
    .values({
      workspaceId: event.workspaceId,
      actorKind: event.actorKind,
      actorId: event.actorId,
      verb: event.type,
      subjectType: SUBJECT_OF[event.type as EventType] ?? "workspace",
      subjectId,
      data: payload,
      eventId: event.id,
    })
    .onConflictDoNothing({ target: activityLogs.eventId });
}

