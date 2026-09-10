/**
 * The outbox dispatcher (DEVELOPMENT_PLAN.md §4.5, §4.6).
 *
 * Reads events nobody has consumed yet and hands them to the handlers. In the
 * MVP there is one handler — the activity feed — and it is idempotent: the
 * entry it writes is keyed on the event, so a retried dispatch cannot produce
 * the same line twice.
 *
 * An action taken by a rule is recorded as `automation`, never as the person
 * who happens to own the workspace.
 */

import { asc, eq, isNull } from "drizzle-orm";
import type { Database, Executor } from "@/server/db/client";
import { activityLogs, outboxEvents } from "@/server/db/schema";
import type { EventType } from "./outbox";

type EventRow = typeof outboxEvents.$inferSelect;

export type DispatchResult = {
  readonly processed: number;
  readonly failed: number;
};

const SUBJECT_OF: Record<EventType, string> = {
  "project.created": "project",
  "project.completed": "project",
  "project.reopened": "project",
  "task.created": "task",
  "task.moved": "task",
  "task.blocked": "task",
  "task.unblocked": "task",
  "task.completed": "task",
  "checklist.completed": "task",
  "comment.added": "task",
  "dependency.resolved": "task",
  "project.health_changed": "project",
  "member.invited": "workspace",
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

  for (const event of pending) {
    try {
      await db.transaction(async (tx) => {
        await recordActivity(tx, event);
        await tx
          .update(outboxEvents)
          .set({ processedAt: new Date(), lastError: null })
          .where(eq(outboxEvents.id, event.id));
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      await db
        .update(outboxEvents)
        .set({
          attempts: event.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(eq(outboxEvents.id, event.id));
    }
  }

  return { processed, failed };
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

