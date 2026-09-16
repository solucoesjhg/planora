/**
 * The transactional outbox (DEVELOPMENT_PLAN.md §4.5).
 *
 * An event is written in the same transaction as the mutation that caused it:
 * a task move either persists and emits `task.moved`, or neither happens.
 * Until Phase 9 the only consumer is the activity feed — but notifications,
 * automations, webhooks and the assistant all read these same rows, which is
 * why the table exists now rather than then.
 */

import type { Executor } from "@/server/db/client";
import { outboxEvents } from "@/server/db/schema";

export const EVENT_TYPES = [
  "project.created",
  "project.completed",
  "project.reopened",
  "task.created",
  "task.moved",
  "task.blocked",
  "task.unblocked",
  "task.completed",
  "task.assigned",
  "checklist.completed",
  "comment.added",
  "dependency.resolved",
  "project.health_changed",
  "member.invited",
  // The clock's own events (§7 Phase 9): one per task per day at most.
  "task.due_soon",
  "task.overdue",
  "task.stalled",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type ActorKind = "user" | "automation" | "ai";

export type DomainEvent = {
  readonly workspaceId: string;
  readonly type: EventType;
  readonly payload: Record<string, unknown>;
  /** Deterministic for one logical operation, so a retry cannot fire twice. */
  readonly dedupeKey: string;
  readonly actorKind?: ActorKind;
  readonly actorId?: string | null;
  readonly occurredAt?: Date;
  /** The event an automation was reacting to when it caused this one. */
  readonly causedBy?: string | null;
  /** How many automations stand between this event and a person's act. */
  readonly depth?: number;
};

export async function emit(
  executor: Executor,
  event: DomainEvent,
): Promise<string | null> {
  const [row] = await executor
    .insert(outboxEvents)
    .values({
      workspaceId: event.workspaceId,
      type: event.type,
      payload: event.payload,
      dedupeKey: event.dedupeKey,
      actorKind: event.actorKind ?? "user",
      actorId: event.actorId ?? null,
      causedBy: event.causedBy ?? null,
      depth: event.depth ?? 0,
      ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
    })
    .onConflictDoNothing({ target: outboxEvents.dedupeKey })
    .returning({ id: outboxEvents.id });

  return row?.id ?? null;
}
