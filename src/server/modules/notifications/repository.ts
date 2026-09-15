/**
 * The inbox and the preferences, as rows (DEVELOPMENT_PLAN.md §7 Phase 9).
 */

import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Channels } from "@/lib/notifications";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { notificationPreferences, notifications } from "@/server/db/schema";

export type NotificationRow = typeof notifications.$inferSelect;
export type PreferenceRow = typeof notificationPreferences.$inferSelect;

export type NewNotification = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly eventId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly email: boolean;
};

/** One row per person per event; a retried dispatch writes nothing twice. */
export async function insertNotifications(
  executor: Executor,
  rows: readonly NewNotification[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const inserted = await executor
    .insert(notifications)
    .values(
      rows.map((row) => ({
        workspaceId: row.workspaceId,
        userId: row.userId,
        eventId: row.eventId,
        type: row.type,
        title: row.title,
        body: row.body,
        href: row.href,
        emailStatus: row.email ? "pending" : "none",
      })),
    )
    .onConflictDoNothing({ target: [notifications.eventId, notifications.userId] })
    .returning({ id: notifications.id });

  return inserted.length;
}

export async function listInbox(
  executor: Executor,
  context: TenantContext,
  limit = 50,
): Promise<NotificationRow[]> {
  return executor
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, context.workspaceId),
        eq(notifications.userId, context.userId),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}

export async function unreadCount(executor: Executor, context: TenantContext): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, context.workspaceId),
        eq(notifications.userId, context.userId),
        isNull(notifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

export async function markRead(
  executor: Executor,
  context: TenantContext,
  ids: readonly string[] | "all",
  now: Date = new Date(),
): Promise<void> {
  const scope = and(
    eq(notifications.workspaceId, context.workspaceId),
    eq(notifications.userId, context.userId),
    isNull(notifications.readAt),
  );
  await executor
    .update(notifications)
    .set({ readAt: now })
    .where(ids === "all" ? scope : and(scope, inArray(notifications.id, [...ids])));
}

/* ------------------------------------------------------------------ *
 * Email delivery
 * ------------------------------------------------------------------ */

export const MAX_EMAIL_ATTEMPTS = 3;

export type PendingEmail = NotificationRow & { readonly to: string };

/** Notifications whose email has not left yet, oldest first, with the address. */
export async function pendingEmails(executor: Executor, limit = 50): Promise<PendingEmail[]> {
  const rows = await executor.execute(sql`
    select n.*, u.email as "to"
      from notifications n
      join users u on u.id = n.user_id
     where n.email_status = 'pending' and n.email_attempts < ${MAX_EMAIL_ATTEMPTS}
     order by n.created_at asc
     limit ${limit}
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    userId: row["user_id"] as string,
    eventId: row["event_id"] as string,
    type: row["type"] as string,
    title: row["title"] as string,
    body: row["body"] as string,
    href: (row["href"] as string | null) ?? null,
    readAt: row["read_at"] ? new Date(row["read_at"] as string) : null,
    emailStatus: row["email_status"] as string,
    emailAttempts: row["email_attempts"] as number,
    emailError: (row["email_error"] as string | null) ?? null,
    createdAt: new Date(row["created_at"] as string),
    to: row["to"] as string,
  }));
}

export async function markEmailSent(executor: Executor, id: string): Promise<void> {
  await executor
    .update(notifications)
    .set({ emailStatus: "sent", emailError: null })
    .where(eq(notifications.id, id));
}

/** Another failed attempt; after the last one the row stops being retried. */
export async function markEmailFailed(
  executor: Executor,
  id: string,
  attempts: number,
  error: string,
): Promise<void> {
  await executor
    .update(notifications)
    .set({
      emailAttempts: attempts,
      emailError: error,
      emailStatus: attempts >= MAX_EMAIL_ATTEMPTS ? "failed" : "pending",
    })
    .where(eq(notifications.id, id));
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

export type PreferenceView = {
  readonly channels: Partial<Record<string, Partial<Channels>>>;
  readonly digest: "none" | "daily" | "weekly";
  readonly lastDigestAt: Date | null;
};

export async function preferencesOf(
  executor: Executor,
  workspaceId: string,
  userIds: readonly string[],
): Promise<Map<string, PreferenceView>> {
  const map = new Map<string, PreferenceView>();
  if (userIds.length === 0) return map;

  const rows = await executor
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.workspaceId, workspaceId),
        inArray(notificationPreferences.userId, [...userIds]),
      ),
    );
  for (const row of rows) {
    map.set(row.userId, {
      channels: (row.channels ?? {}) as PreferenceView["channels"],
      digest: row.digest as PreferenceView["digest"],
      lastDigestAt: row.lastDigestAt,
    });
  }
  return map;
}

export async function savePreferences(
  executor: Executor,
  context: TenantContext,
  input: { channels: Partial<Record<string, Partial<Channels>>>; digest: "none" | "daily" | "weekly" },
): Promise<void> {
  await executor
    .insert(notificationPreferences)
    .values({
      workspaceId: context.workspaceId,
      userId: context.userId,
      channels: input.channels,
      digest: input.digest,
    })
    .onConflictDoUpdate({
      target: [notificationPreferences.workspaceId, notificationPreferences.userId],
      set: { channels: input.channels, digest: input.digest, updatedAt: new Date() },
    });
}

/** Everyone who asked for a digest and is due one. */
export async function digestsDue(
  executor: Executor,
  now: Date,
): Promise<(PreferenceRow & { email: string; name: string })[]> {
  const rows = await executor.execute(sql`
    select p.*, u.email, u.name
      from notification_preferences p
      join users u on u.id = p.user_id
     where p.digest <> 'none'
       and (p.last_digest_at is null
            or (p.digest = 'daily'  and p.last_digest_at < ${new Date(now.getTime() - 24 * 3600_000).toISOString()}::timestamptz)
            or (p.digest = 'weekly' and p.last_digest_at < ${new Date(now.getTime() - 7 * 24 * 3600_000).toISOString()}::timestamptz))
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    workspaceId: row["workspace_id"] as string,
    userId: row["user_id"] as string,
    channels: (row["channels"] ?? {}) as PreferenceRow["channels"],
    digest: row["digest"] as string,
    // A raw query hands timestamps back as strings; the comparisons want Dates.
    lastDigestAt: row["last_digest_at"] ? new Date(row["last_digest_at"] as string) : null,
    updatedAt: new Date(row["updated_at"] as string),
    email: row["email"] as string,
    name: row["name"] as string,
  }));
}

/** What a digest lists: unread since the last one, oldest first, capped. */
export async function unreadSince(
  executor: Executor,
  workspaceId: string,
  userId: string,
  since: Date | null,
  limit = 50,
): Promise<NotificationRow[]> {
  return executor
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        since ? gt(notifications.createdAt, since) : sql`true`,
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
}

export async function markDigestSent(
  executor: Executor,
  workspaceId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(notificationPreferences)
    .set({ lastDigestAt: now })
    .where(
      and(
        eq(notificationPreferences.workspaceId, workspaceId),
        eq(notificationPreferences.userId, userId),
      ),
    );
}

/** Older unread rows the inbox no longer needs — a housekeeping query for the clock. */
export async function unreadOlderThan(executor: Executor, before: Date): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(isNull(notifications.readAt), lt(notifications.createdAt, before)));
  return row?.n ?? 0;
}
