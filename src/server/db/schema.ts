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

/* ---------------------------------------------------------------- *
 * Portfolio
 * ---------------------------------------------------------------- */

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    startDate: date("start_date", { mode: "date" }),
    dueDate: date("due_date", { mode: "date" }),
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
    startDate: date("start_date", { mode: "date" }),
    dueDate: date("due_date", { mode: "date" }),
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
  workspaces,
  workspaceMembers,
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
