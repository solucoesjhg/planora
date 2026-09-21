/**
 * The event catalogue (DEVELOPMENT_PLAN.md §4.5).
 *
 * The names live here, apart from the writer that persists them, because
 * everything downstream has to spell an event out: the dispatcher gives each
 * one a subject, the feed gives each one a sentence, the automations wait on
 * a subset. Only the writer needs the database, so only the writer should
 * have to import it — a Server Component rendering the feed must be able to
 * name `task.overdue` without pulling the schema along.
 *
 * Adding a name here is deliberately noisy: every `Record<EventType, …>` in
 * the codebase stops compiling until its owner says what the new event means.
 */

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
