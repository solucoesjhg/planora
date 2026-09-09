/**
 * The deterministic seed (DEVELOPMENT_PLAN.md §4.7).
 *
 * Fixed ids and a frozen clock, so "the seed rebuilds the identical state on
 * every run" is a claim a test can make. Its content is chosen so that every
 * health dimension has something to say: blocks, dependencies, dates, stale
 * cards and a project that is behind its calendar.
 */

import { sql } from "drizzle-orm";
import { keyBetween } from "@/domain/kanban";
import { fixedId } from "@/lib/id";
import type { Database } from "./client";
import {
  boardColumns,
  projects,
  taskChecklistItems,
  taskDependencies,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "./schema";

export const SEED_EPOCH = new Date("2026-09-01T12:00:00.000Z");

const DAY = 86_400_000;
const at = (days: number) => new Date(SEED_EPOCH.getTime() + days * DAY);

export const seedIds = {
  user: fixedId("user", 1),
  workspace: fixedId("workspace", 1),
  projects: [fixedId("project", 1), fixedId("project", 2)] as const,
  column: (projectIndex: number, phaseIndex: number) =>
    fixedId(`column-${projectIndex}`, phaseIndex),
  task: (index: number) => fixedId("task", index),
};

const PHASE_NAMES = [
  ["planning", "Planejamento"],
  ["execution", "Execução"],
  ["review", "Revisão"],
  ["done", "Concluído"],
] as const;

/** Empties every table this seed writes to, so a rebuild starts from nothing. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    truncate table
      activity_logs,
      outbox_events,
      task_phase_history,
      task_comments,
      task_dependencies,
      task_checklist_items,
      task_assignees,
      tasks,
      board_columns,
      projects,
      workspace_members,
      workspaces,
      users
    restart identity cascade
  `);
}

export type SeedResult = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectIds: readonly string[];
  readonly taskIds: readonly string[];
};

export async function seed(db: Database): Promise<SeedResult> {
  await resetDatabase(db);

  await db.insert(users).values({
    id: seedIds.user,
    email: "henrique@planora.local",
    name: "Henrique",
    emailVerified: true,
    createdAt: at(-40),
    updatedAt: at(-40),
  });

  await db.insert(workspaces).values({
    id: seedIds.workspace,
    name: "Planora",
    slug: "planora",
    createdBy: seedIds.user,
    createdAt: at(-40),
    updatedAt: at(-40),
  });

  await db.insert(workspaceMembers).values({
    id: fixedId("member", 1),
    workspaceId: seedIds.workspace,
    userId: seedIds.user,
    role: "owner",
    createdAt: at(-40),
  });

  await db.insert(projects).values([
    {
      id: seedIds.projects[0],
      workspaceId: seedIds.workspace,
      name: "Reforma do escritório",
      description: "Obra civil com etapas encadeadas.",
      status: "active",
      startDate: at(-30),
      dueDate: at(30),
      position: "V",
      createdBy: seedIds.user,
      createdAt: at(-30),
      updatedAt: at(-30),
    },
    {
      id: seedIds.projects[1],
      workspaceId: seedIds.workspace,
      name: "Site institucional",
      description: "Entrega em duas fases.",
      status: "active",
      startDate: at(-20),
      dueDate: at(10),
      position: "l",
      createdBy: seedIds.user,
      createdAt: at(-20),
      updatedAt: at(-20),
    },
  ]);

  const columnIds: string[][] = [];
  for (const [projectIndex, projectId] of seedIds.projects.entries()) {
    let position: string | null = null;
    const ids: string[] = [];

    for (const [phaseIndex, [phase, name]] of PHASE_NAMES.entries()) {
      const columnId = seedIds.column(projectIndex, phaseIndex);
      position = keyBetween(position, null);
      ids.push(columnId);

      await db.insert(boardColumns).values({
        id: columnId,
        workspaceId: seedIds.workspace,
        projectId,
        name,
        phase,
        position,
        createdAt: at(-30),
        updatedAt: at(-30),
      });
    }

    columnIds.push(ids);
  }

  const taskIds: string[] = [];
  let number = 0;

  for (const [projectIndex, projectId] of seedIds.projects.entries()) {
    const projectColumns = columnIds[projectIndex] ?? [];
    const perProject = projectIndex === 0 ? 12 : 8;
    let position: string | null = null;

    for (let index = 0; index < perProject; index += 1) {
      number += 1;
      const taskId = seedIds.task(number);
      taskIds.push(taskId);

      const phaseIndex = index % 4;
      const columnId = projectColumns[phaseIndex] ?? projectColumns[0] ?? "";
      position = keyBetween(position, null);

      // A stale card here and there, one blocked, a couple overdue.
      const stale = index === 2 || index === 7;
      const blocked = index === 1 && projectIndex === 0;
      const overdue = index === 3;

      await db.insert(tasks).values({
        id: taskId,
        workspaceId: seedIds.workspace,
        projectId,
        columnId,
        number,
        title: `Tarefa ${number}`,
        body: "",
        internalNotes: index % 3 === 0 ? "<p>Nota interna da fase.</p>" : "",
        priority: index % 5 === 0 ? "high" : index % 3 === 0 ? "low" : "medium",
        blocked,
        blockedAt: blocked ? at(-6) : null,
        blockReason: blocked ? "Aguardando material" : null,
        dueDate: overdue ? at(-5) : index % 2 === 0 ? at(14) : null,
        position,
        enteredColumnAt: stale ? at(-21) : at(-2),
        createdBy: seedIds.user,
        createdAt: at(-25),
        updatedAt: at(-25),
      });

      if (index % 4 === 1) {
        await db.insert(taskChecklistItems).values([
          {
            id: fixedId(`checklist-${number}`, 1),
            workspaceId: seedIds.workspace,
            taskId,
            title: "Levantamento",
            done: true,
            position: "V",
            createdAt: at(-20),
            updatedAt: at(-20),
          },
          {
            id: fixedId(`checklist-${number}`, 2),
            workspaceId: seedIds.workspace,
            taskId,
            title: "Execução",
            done: false,
            position: "l",
            createdAt: at(-20),
            updatedAt: at(-20),
          },
        ]);
      }
    }
  }

  // One chain, so blocking has a root to report.
  const [first, second] = [seedIds.task(5), seedIds.task(2)];
  if (first && second) {
    await db.insert(taskDependencies).values({
      id: fixedId("dependency", 1),
      workspaceId: seedIds.workspace,
      taskId: first,
      dependsOnId: second,
      createdAt: at(-15),
    });
  }

  return {
    workspaceId: seedIds.workspace,
    userId: seedIds.user,
    projectIds: [...seedIds.projects],
    taskIds,
  };
}
