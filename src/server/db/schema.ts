/**
 * The schema (DEVELOPMENT_PLAN.md §4).
 *
 * Conventions that hold everywhere: `workspace_id` on every business table
 * from the first migration; composite foreign keys that carry the tenant, so
 * the database itself refuses a cross-workspace link; every query index leads
 * with `workspace_id`; UUID v7 keys generated in the application; timestamps in
 * UTC; enumerations as text with a check constraint.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative rather than aliased: drizzle-kit loads this file on its own, without
// the tsconfig path mapping.
import { newId } from "../../lib/id";

export const PHASES = ["planning", "execution", "review", "done"] as const;
export const PRIORITIES = ["high", "medium", "low"] as const;
export const ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
export const ACTOR_KINDS = ["user", "automation", "ai"] as const;
export const PROJECT_STATUSES = ["active", "completed"] as const;

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => newId());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(", ")})`);

/* ---------------------------------------------------------------- *
 * Identity — Phase 2 defines only what other tables point at. The
 * sessions, accounts and verification tables arrive in Phase 3 with
 * Better Auth's own adapter, whose shape is its business, not ours.
 * ---------------------------------------------------------------- */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  image: text("image"),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Better Auth owns the three tables below. Their field names are its contract,
 * not ours — the adapter maps its models onto them through `usePlural`.
 */

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("sessions_user_idx").on(table.userId, table.expiresAt)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    /** Hashed by Better Auth; never read by application code. */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("accounts_provider_account").on(table.providerId, table.accountId),
    index("accounts_user_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("verifications_identifier_idx").on(table.identifier, table.expiresAt),
  ],
);

/**
 * Better Auth's rate-limit counters. In the database rather than in memory,
 * because a serverless deployment runs many instances and a per-instance
 * counter is a limiter that does not limit.
 */
export const rateLimits = pgTable("rate_limits", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull().default(0),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* ---------------------------------------------------------------- *
 * Tenancy
 * ---------------------------------------------------------------- */

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("workspace_members_workspace_user").on(table.workspaceId, table.userId),
    index("workspace_members_workspace_idx").on(table.workspaceId, table.role),
    check("workspace_members_role", inList("role", ROLES)),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    /**
     * SHA-256 of the token that was emailed. The token itself is never stored,
     * so a copy of this table cannot be replayed as a pile of live invitations.
     */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    // One live invitation per address per workspace; accepting frees the slot.
    uniqueIndex("workspace_invitations_pending")
      .on(table.workspaceId, table.email)
      .where(sql`accepted_at is null`),
    index("workspace_invitations_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check("workspace_invitations_role", inList("role", ROLES)),
  ],
);

/* ---------------------------------------------------------------- *
 * Portfolio
 * ---------------------------------------------------------------- */

/**
 * A real record, replacing the v1's "client directory" that was a scan over
 * e-mail strings typed into projects. It is also what a per-project share will
 * hang from when client access arrives (§6.5).
 */
export const clients = pgTable(
  "clients",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("clients_workspace_id_key").on(table.workspaceId, table.id),
    unique("clients_workspace_name").on(table.workspaceId, table.name),
    index("clients_workspace_idx").on(table.workspaceId, table.name),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    // `string` rather than `date`: a calendar day has no time and no zone, and
    // turning it into an instant is what showed every deadline a day early.
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    position: text("position").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Lets children carry the tenant in their own foreign key.
    unique("projects_workspace_id_key").on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.clientId],
      foreignColumns: [clients.workspaceId, clients.id],
      name: "projects_client_fk",
    }).onDelete("set null"),
    index("projects_workspace_status_idx").on(table.workspaceId, table.status),
    check("projects_status", inList("status", PROJECT_STATUSES)),
  ],
);

export const boardColumns = pgTable(
  "board_columns",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    phase: text("phase").notNull(),
    position: text("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "board_columns_project_fk",
    }).onDelete("cascade"),
    unique("board_columns_workspace_id_key").on(table.workspaceId, table.id),
    index("board_columns_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
      table.position,
    ),
    // At most one planning and one done column per project (§4.4). Existence is
    // the creating service's job: an index can forbid a second, not require a
    // first.
    uniqueIndex("board_columns_one_planning")
      .on(table.projectId)
      .where(sql`phase = 'planning'`),
    uniqueIndex("board_columns_one_done")
      .on(table.projectId)
      .where(sql`phase = 'done'`),
    check("board_columns_phase", inList("phase", PHASES)),
  ],
);

/* ---------------------------------------------------------------- *
 * Work
 * ---------------------------------------------------------------- */

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    columnId: uuid("column_id").notNull(),
    parentTaskId: uuid("parent_task_id"),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    internalNotes: text("internal_notes").notNull().default(""),
    priority: text("priority").notNull().default("medium"),
    blocked: boolean("blocked").notNull().default(false),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockReason: text("block_reason"),
    // `string` rather than `date`: a calendar day has no time and no zone, and
    // turning it into an instant is what showed every deadline a day early.
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    position: text("position").notNull(),
    enteredColumnAt: timestamp("entered_column_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "tasks_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.columnId],
      foreignColumns: [boardColumns.workspaceId, boardColumns.id],
      name: "tasks_column_fk",
    }),
    foreignKey({
      columns: [table.parentTaskId],
      foreignColumns: [table.id],
      name: "tasks_parent_fk",
    }),
    unique("tasks_workspace_id_key").on(table.workspaceId, table.id),
    // TSK-N is per project, assigned in the insert's own transaction.
    unique("tasks_project_number").on(table.projectId, table.number),
    index("tasks_workspace_column_idx").on(
      table.workspaceId,
      table.columnId,
      table.position,
    ),
    index("tasks_workspace_due_idx").on(table.workspaceId, table.dueDate),
    check("tasks_priority", inList("priority", PRIORITIES)),
  ],
);

export const taskAssignees = pgTable(
  "task_assignees",
  {
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    foreignKey({
      columns: [table.workspaceId, table.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "task_assignees_task_fk",
    }).onDelete("cascade"),
    index("task_assignees_workspace_user_idx").on(table.workspaceId, table.userId),
  ],
);

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    position: text("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "task_checklist_items_task_fk",
    }).onDelete("cascade"),
    index("task_checklist_items_workspace_task_idx").on(
      table.workspaceId,
      table.taskId,
      table.position,
    ),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    dependsOnId: uuid("depends_on_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "task_dependencies_task_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.dependsOnId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "task_dependencies_depends_on_fk",
    }).onDelete("cascade"),
    unique("task_dependencies_edge").on(table.taskId, table.dependsOnId),
    index("task_dependencies_workspace_task_idx").on(
      table.workspaceId,
      table.taskId,
    ),
    // Cycles longer than one hop are the domain's job (§3.7).
    check("task_dependencies_not_self", sql`task_id <> depends_on_id`),
  ],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "task_comments_task_fk",
    }).onDelete("cascade"),
    index("task_comments_workspace_task_idx").on(
      table.workspaceId,
      table.taskId,
      table.createdAt,
    ),
  ],
);

export const ATTACHMENT_STATUSES = ["pending", "stored"] as const;

/**
 * Attachment metadata. The bytes live in a private bucket; this table holds
 * where they are and what the store said about them, never the file itself.
 *
 * A row is written `pending` when the upload ticket is issued and turns
 * `stored` once the object is actually there — an upload the person abandoned
 * leaves a row that no screen shows and a sweep can remove.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** Null while an image is dropped into an editor before the task exists. */
    taskId: uuid("task_id"),
    bucket: text("bucket").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    checksum: text("checksum").notNull().default(""),
    status: text("status").notNull().default("pending"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    storedAt: timestamp("stored_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: "attachments_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "attachments_task_fk",
    }).onDelete("cascade"),
    unique("attachments_workspace_id_key").on(table.workspaceId, table.id),
    // One row per object: the path carries the id, so this is a guard, not a rule.
    uniqueIndex("attachments_path_key").on(table.bucket, table.path),
    index("attachments_workspace_task_idx").on(
      table.workspaceId,
      table.taskId,
      table.createdAt,
    ),
    index("attachments_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
      table.createdAt,
    ),
    check("attachments_status", inList("status", ATTACHMENT_STATUSES)),
  ],
);

/* ---------------------------------------------------------------- *
 * Trail
 * ---------------------------------------------------------------- */

export const taskPhaseHistory = pgTable(
  "task_phase_history",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    fromColumnId: uuid("from_column_id"),
    toColumnId: uuid("to_column_id").notNull(),
    fromPhase: text("from_phase"),
    toPhase: text("to_phase").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorKind: text("actor_kind").notNull().default("user"),
    actorId: uuid("actor_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "task_phase_history_task_fk",
    }).onDelete("cascade"),
    // Freshness reads days-in-column from here (§4.3).
    index("task_phase_history_workspace_task_idx").on(
      table.workspaceId,
      table.taskId,
      table.at,
    ),
    check("task_phase_history_to_phase", inList("to_phase", PHASES)),
    check("task_phase_history_actor_kind", inList("actor_kind", ACTOR_KINDS)),
  ],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** user · automation · ai — an automation never signs as a person (§4.6). */
    actorKind: text("actor_kind").notNull().default("user"),
    actorId: uuid("actor_id"),
    verb: text("verb").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    data: jsonb("data").notNull().default({}),
    /** The event this entry was derived from; keeps the feed idempotent. */
    eventId: uuid("event_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("activity_logs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    uniqueIndex("activity_logs_event_key").on(table.eventId),
    check("activity_logs_actor_kind", inList("actor_kind", ACTOR_KINDS)),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** A retried publish cannot fire a consumer twice (§4.4). */
    dedupeKey: text("dedupe_key").notNull(),
    actorKind: text("actor_kind").notNull().default("user"),
    actorId: uuid("actor_id"),
  },
  (table) => [
    unique("outbox_events_dedupe_key").on(table.dedupeKey),
    index("outbox_events_pending_idx").on(table.processedAt, table.occurredAt),
    index("outbox_events_workspace_idx").on(table.workspaceId, table.occurredAt),
    check("outbox_events_actor_kind", inList("actor_kind", ACTOR_KINDS)),
  ],
);

export const schema = {
  users,
  clients,
  sessions,
  accounts,
  verifications,
  rateLimits,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  projects,
  boardColumns,
  tasks,
  taskAssignees,
  taskChecklistItems,
  taskDependencies,
  taskComments,
  taskPhaseHistory,
  activityLogs,
  outboxEvents,
};
