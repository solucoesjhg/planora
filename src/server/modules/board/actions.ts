"use server";

import { revalidatePath } from "next/cache";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { z } from "zod";
import { isRefused, type Result } from "@/lib/result";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import {
  createColumn,
  deleteColumn,
  moveColumn,
  renameColumn,
  type ColumnFailure,
} from "./columns";
import { moveTask, type MoveTaskFailure } from "./service";
import { phaseLabel } from "@/lib/strings";

export type BoardActionResult<Failure> =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Failure; readonly detail?: string };

const moveSchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid(),
  toColumnId: z.uuid(),
  afterTaskId: z.uuid().nullable().optional(),
  beforeTaskId: z.uuid().nullable().optional(),
  ack: z.literal("checklist").optional(),
});

export async function moveTaskAction(
  input: z.input<typeof moveSchema>,
): Promise<BoardActionResult<MoveTaskFailure>> {
  const parsed = moveSchema.parse(input);
  const context = await requireWorkspace();

  const result = await moveTask(getDatabase(), context, {
    taskId: parsed.taskId,
    toColumnId: parsed.toColumnId,
    afterTaskId: parsed.afterTaskId ?? null,
    beforeTaskId: parsed.beforeTaskId ?? null,
    // The archived note is titled in the language of the interface.
    phaseLabel,
    ...(parsed.ack ? { ack: parsed.ack } : {}),
  });

  revalidatePath(`/projects/${parsed.projectId}`);

  dispatchSoon();
  return toResult(result);
}

const createColumnSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  phase: z.enum(["execution", "review"]),
});

export async function createColumnAction(
  input: z.input<typeof createColumnSchema>,
): Promise<BoardActionResult<ColumnFailure>> {
  const parsed = createColumnSchema.parse(input);
  const context = await requireWorkspace();

  const result = await createColumn(getDatabase(), context, parsed);
  revalidatePath(`/projects/${parsed.projectId}`);
  dispatchSoon();
  return toResult(result);
}

const renameColumnSchema = z.object({
  projectId: z.uuid(),
  columnId: z.uuid(),
  name: z.string().trim().min(1).max(60),
});

export async function renameColumnAction(
  input: z.input<typeof renameColumnSchema>,
): Promise<BoardActionResult<ColumnFailure>> {
  const parsed = renameColumnSchema.parse(input);
  const context = await requireWorkspace();

  const result = await renameColumn(getDatabase(), context, {
    columnId: parsed.columnId,
    name: parsed.name,
  });

  revalidatePath(`/projects/${parsed.projectId}`);

  dispatchSoon();
  return toResult(result);
}

const columnSchema = z.object({
  projectId: z.uuid(),
  columnId: z.uuid(),
});

export async function deleteColumnAction(
  input: z.input<typeof columnSchema>,
): Promise<BoardActionResult<ColumnFailure>> {
  const parsed = columnSchema.parse(input);
  const context = await requireWorkspace();

  const result = await deleteColumn(getDatabase(), context, parsed.columnId);
  revalidatePath(`/projects/${parsed.projectId}`);
  dispatchSoon();
  return toResult(result);
}

const moveColumnSchema = columnSchema.extend({
  afterId: z.uuid().nullable().optional(),
  beforeId: z.uuid().nullable().optional(),
});

export async function moveColumnAction(
  input: z.input<typeof moveColumnSchema>,
): Promise<BoardActionResult<ColumnFailure>> {
  const parsed = moveColumnSchema.parse(input);
  const context = await requireWorkspace();

  const result = await moveColumn(getDatabase(), context, {
    columnId: parsed.columnId,
    afterId: parsed.afterId ?? null,
    beforeId: parsed.beforeId ?? null,
  });

  revalidatePath(`/projects/${parsed.projectId}`);

  dispatchSoon();
  return toResult(result);
}

function toResult<Value, Failure extends string>(
  result: Result<Value, Failure>,
): BoardActionResult<Failure> {
  if (!isRefused(result)) return { ok: true };
  return result.detail === undefined
    ? { ok: false, reason: result.reason }
    : { ok: false, reason: result.reason, detail: result.detail };
}
