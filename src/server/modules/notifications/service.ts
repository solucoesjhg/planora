/**
 * Who is told what (DEVELOPMENT_PLAN.md §7 Phase 9).
 *
 * The dispatcher calls `notifyFor` once per event, inside the event's
 * transaction: recipients are resolved, each person's preferences applied,
 * and one inbox row written per person — the unique index on
 * `(event_id, user_id)` is what makes a retried dispatch harmless. Email is a
 * *delivery* of that row, attempted up to three times by the clock; a failed
 * delivery never produces a second row.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  type NotifiableType,
  channelsFor,
  isNotifiable,
  notificationText,
} from "@/lib/notifications";
import type { Database, Executor } from "@/server/db/client";
import {
  outboxEvents,
  projects,
  taskAssignees,
  tasks,
  users,
  workspaceMembers,
} from "@/server/db/schema";
import type { EmailSender } from "@/server/email/sender";
import { digestEmail, notificationEmail } from "@/server/email/templates";
import {
  digestsDue,
  insertNotifications,
  markDigestSent,
  markEmailFailed,
  markEmailSent,
  membersAmong,
  pendingEmails,
  preferencesOf,
  unreadSince,
  type NewNotification,
} from "./repository";

type EventRow = typeof outboxEvents.$inferSelect;

/** The roles a project-level warning goes to. */
const MANAGING_ROLES = ["owner", "admin", "manager"] as const;

/**
 * The people an event concerns, minus whoever caused it — nobody needs to be
 * told what they just did themselves — and minus anybody who is not in the
 * workspace. A payload names people as ids, and an id in a payload is not a
 * membership: the barrier accepts a row naming a stranger as long as its
 * workspace is right, and the email this row becomes would leave Planora's
 * domain for that stranger (ADR 0004).
 */
export async function recipientsOf(executor: Executor, event: EventRow): Promise<string[]> {
  return membersAmong(executor, event.workspaceId, await concernedBy(executor, event));
}

async function concernedBy(executor: Executor, event: EventRow): Promise<string[]> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const actor = event.actorKind === "user" ? event.actorId : null;
  const without = (ids: readonly string[]) => [...new Set(ids)].filter((id) => id !== actor);

  if (event.type === "task.assigned") {
    const named = Array.isArray(payload["userIds"])
      ? payload["userIds"].filter((each): each is string => typeof each === "string")
      : [];
    return without(named);
  }

  if (event.type === "project.health_changed") {
    const rows = await executor
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, event.workspaceId),
          inArray(workspaceMembers.role, [...MANAGING_ROLES]),
        ),
      );
    return without(rows.map((row) => row.userId));
  }

  const taskId = typeof payload["taskId"] === "string" ? payload["taskId"] : null;
  if (!taskId) return [];

  const [task] = await executor
    .select({ createdBy: tasks.createdBy })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, event.workspaceId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return [];

  const assignees = await executor
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.workspaceId, event.workspaceId), eq(taskAssignees.taskId, taskId)));
  const assigned = assignees.map((row) => row.userId);

  // The clock's events go to whoever holds the task; with nobody holding it,
  // to whoever created it. A person's events go to both.
  if (event.type.startsWith("task.") && ["task.due_soon", "task.overdue", "task.stalled"].includes(event.type)) {
    return without(assigned.length > 0 ? assigned : [task.createdBy]);
  }
  return without([...assigned, task.createdBy]);
}

/** Inbox rows for one event, per person and per their preferences. */
export async function notifyFor(executor: Executor, event: EventRow): Promise<number> {
  if (!isNotifiable(event.type)) return 0;
  const type: NotifiableType = event.type;

  const recipients = await recipientsOf(executor, event);
  if (recipients.length === 0) return 0;

  const [preferences, subject] = await Promise.all([
    preferencesOf(executor, event.workspaceId, recipients),
    subjectOf(executor, event),
  ]);
  const text = notificationText(subject);

  const rows: NewNotification[] = [];
  for (const userId of recipients) {
    const channels = channelsFor(type, preferences.get(userId)?.channels);
    if (!channels.inApp && !channels.email) continue;
    rows.push({
      workspaceId: event.workspaceId,
      userId,
      eventId: event.id,
      type,
      title: text.title,
      body: text.body,
      href: text.href,
      email: channels.email,
    });
  }
  return insertNotifications(executor, rows);
}

/** What the text needs to know about the event: names, numbers, the actor. */
async function subjectOf(executor: Executor, event: EventRow) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const taskId = typeof payload["taskId"] === "string" ? payload["taskId"] : null;
  const projectIdFromPayload = typeof payload["projectId"] === "string" ? payload["projectId"] : null;

  const [task] = taskId
    ? await executor
        .select({ id: tasks.id, number: tasks.number, title: tasks.title, projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, event.workspaceId), eq(tasks.id, taskId)))
        .limit(1)
    : [];
  const projectId = task?.projectId ?? projectIdFromPayload;
  const [project] = projectId
    ? await executor
        .select({ name: projects.name })
        .from(projects)
        .where(and(eq(projects.workspaceId, event.workspaceId), eq(projects.id, projectId)))
        .limit(1)
    : [];
  const [actor] = event.actorId
    ? await executor.select({ name: users.name }).from(users).where(eq(users.id, event.actorId)).limit(1)
    : [];

  return {
    type: event.type,
    data: payload,
    actorName: actor?.name ?? null,
    actorKind: event.actorKind,
    taskId: task?.id ?? null,
    taskNumber: task?.number ?? null,
    taskTitle: task?.title ?? null,
    projectId: projectId ?? null,
    projectName: project?.name ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Email — a delivery, retried; never a second side effect
 * ------------------------------------------------------------------ */

export type DeliveryResult = { readonly sent: number; readonly failed: number };

export async function deliverPendingEmails(
  db: Database,
  sender: EmailSender,
  baseUrl: string,
  limit = 50,
): Promise<DeliveryResult> {
  const pending = await pendingEmails(db, limit);
  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      await sender.send(
        notificationEmail({
          to: row.to,
          title: row.title,
          body: row.body,
          url: row.href ? new URL(row.href, baseUrl).toString() : baseUrl,
        }),
      );
      await markEmailSent(db, row.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await markEmailFailed(
        db,
        row.id,
        row.emailAttempts + 1,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { sent, failed };
}

/** One email per person listing what they have not read, at the cadence they chose. */
export async function sendDigests(
  db: Database,
  sender: EmailSender,
  baseUrl: string,
  now: Date = new Date(),
): Promise<number> {
  const due = await digestsDue(db, now);
  let sent = 0;

  for (const person of due) {
    const unread = await unreadSince(db, person.workspaceId, person.userId, person.lastDigestAt);
    if (unread.length > 0) {
      await sender.send(
        digestEmail({
          to: person.email,
          name: person.name,
          cadence: person.digest === "weekly" ? "weekly" : "daily",
          items: unread.map((row) => ({
            title: row.title,
            body: row.body,
            url: row.href ? new URL(row.href, baseUrl).toString() : baseUrl,
          })),
          inboxUrl: new URL("/inbox", baseUrl).toString(),
        }),
      );
      sent += 1;
    }
    // Nothing to say still counts as this period's digest.
    await markDigestSent(db, person.workspaceId, person.userId, now);
  }

  return sent;
}
