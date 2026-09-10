/**
 * The example project a new account lands on (DEVELOPMENT_PLAN.md §6.2).
 *
 * An empty first screen teaches nothing. This one is small but complete: work
 * spread across the phases, a checklist part-done, a dependency, and one
 * blocked card — so progress, health and the rule that refuses to finish a
 * project with stuck work all have something to say on day one.
 */

import { keyBetween } from "@/domain/kanban";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import {
  boardColumns,
  taskChecklistItems,
  taskDependencies,
  tasks,
} from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { insertProject } from "./repository";

const DAY = 86_400_000;

export const EXAMPLE_PROJECT_NAME = "Exemplo · Reforma da sala";

type SeedTask = {
  readonly title: string;
  readonly phase: "planning" | "execution" | "review" | "done";
  readonly priority?: "high" | "medium" | "low";
  readonly dueInDays?: number;
  readonly blocked?: string;
  readonly checklist?: readonly { title: string; done: boolean }[];
  readonly dependsOnTitle?: string;
};

const SEED_TASKS: readonly SeedTask[] = [
  {
    title: "Medir o cômodo e listar materiais",
    phase: "done",
    priority: "medium",
    checklist: [
      { title: "Medidas conferidas", done: true },
      { title: "Lista fechada", done: true },
    ],
  },
  {
    title: "Orçar com três fornecedores",
    phase: "done",
    priority: "high",
  },
  {
    title: "Instalar a bancada",
    phase: "execution",
    priority: "high",
    dueInDays: 6,
    checklist: [
      { title: "Bancada entregue", done: true },
      { title: "Suportes fixados", done: false },
      { title: "Acabamento", done: false },
    ],
  },
  {
    title: "Pintura da parede norte",
    phase: "execution",
    priority: "medium",
    dueInDays: -2,
    blocked: "Aguardando a tinta chegar",
  },
  {
    title: "Conferir acabamento com o cliente",
    phase: "review",
    priority: "medium",
    dueInDays: 12,
    dependsOnTitle: "Instalar a bancada",
  },
  {
    title: "Contratar a limpeza pós-obra",
    phase: "planning",
    priority: "low",
  },
];

export async function createExampleProject(
  executor: Executor,
  context: TenantContext,
  now: Date = new Date(),
): Promise<string> {
  const project = await insertProject(executor, context, {
    name: EXAMPLE_PROJECT_NAME,
    description:
      "Um projeto de demonstração. Apague quando quiser — ou renomeie e comece por ele.",
    startDate: new Date(now.getTime() - 14 * DAY),
    dueDate: new Date(now.getTime() + 21 * DAY),
  });

  const columns = await executor
    .select({ id: boardColumns.id, phase: boardColumns.phase })
    .from(boardColumns)
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.projectId, project.id),
      ),
    );

  const columnFor = (phase: string) =>
    columns.find((column) => column.phase === phase)?.id ?? columns[0]?.id ?? "";

  const idsByTitle = new Map<string, string>();
  let position: string | null = null;
  let number = 0;

  for (const seed of SEED_TASKS) {
    number += 1;
    position = keyBetween(position, null);

    const [row] = await executor
      .insert(tasks)
      .values({
        workspaceId: context.workspaceId,
        projectId: project.id,
        columnId: columnFor(seed.phase),
        number,
        title: seed.title,
        priority: seed.priority ?? "medium",
        blocked: Boolean(seed.blocked),
        blockedAt: seed.blocked ? new Date(now.getTime() - 3 * DAY) : null,
        blockReason: seed.blocked ?? null,
        dueDate:
          seed.dueInDays === undefined
            ? null
            : new Date(now.getTime() + seed.dueInDays * DAY),
        position,
        enteredColumnAt: new Date(now.getTime() - 4 * DAY),
        createdBy: context.userId,
      })
      .returning({ id: tasks.id });

    if (!row) throw new Error("example task insert returned nothing");
    idsByTitle.set(seed.title, row.id);

    let itemPosition: string | null = null;
    for (const item of seed.checklist ?? []) {
      itemPosition = keyBetween(itemPosition, null);
      await executor.insert(taskChecklistItems).values({
        workspaceId: context.workspaceId,
        taskId: row.id,
        title: item.title,
        done: item.done,
        position: itemPosition,
      });
    }
  }

  for (const seed of SEED_TASKS) {
    if (!seed.dependsOnTitle) continue;

    const taskId = idsByTitle.get(seed.title);
    const dependsOnId = idsByTitle.get(seed.dependsOnTitle);
    if (!taskId || !dependsOnId) continue;

    await executor.insert(taskDependencies).values({
      workspaceId: context.workspaceId,
      taskId,
      dependsOnId,
    });
  }

  return project.id;
}
