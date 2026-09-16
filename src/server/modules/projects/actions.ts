"use server";

/**
 * The write path (DEVELOPMENT_PLAN.md §2.3).
 *
 * An action validates its input and hands over. It does not decide anything:
 * the service authorizes and transacts, and the domain says whether the move
 * is allowed at all.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { z } from "zod";
import { LAST_BOARD_COOKIE } from "@/lib/last-board";
import { isRefused, type Result } from "@/lib/result";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import {
  completeProject,
  createProject,
  deleteProject,
  editProject,
  moveProject,
  reopenProject,
  type ProjectFailure,
} from "./service";

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ProjectFailure; readonly detail?: string };

/** A calendar day travels as `YYYY-MM-DD`, never as an instant. */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "expected YYYY-MM-DD",
  });

const createSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao projeto").max(120),
  description: z.string().trim().max(500).optional(),
  clientName: z.string().trim().max(120).optional(),
  startDate: optionalDate,
  dueDate: optionalDate,
});

export async function createProjectAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult> {
  const parsed = createSchema.parse(input);
  const context = await requireWorkspace();

  const result = await createProject(getDatabase(), context, {
    name: parsed.name,
    description: parsed.description ?? "",
    clientName: parsed.clientName,
    startDate: parsed.startDate,
    dueDate: parsed.dueDate,
  });

  revalidatePath("/projects");

  dispatchSoon();
  return toActionResult(result);
}

const editSchema = createSchema.partial().extend({
  projectId: z.uuid(),
});

export async function editProjectAction(
  input: z.input<typeof editSchema>,
): Promise<ActionResult> {
  const parsed = editSchema.parse(input);
  const context = await requireWorkspace();

  const result = await editProject(getDatabase(), context, {
    projectId: parsed.projectId,
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    ...(parsed.clientName === undefined ? {} : { clientName: parsed.clientName }),
    ...(parsed.startDate === undefined ? {} : { startDate: parsed.startDate }),
    ...(parsed.dueDate === undefined ? {} : { dueDate: parsed.dueDate }),
  });

  revalidatePath("/projects");

  dispatchSoon();
  return toActionResult(result);
}

const completeSchema = z.object({
  projectId: z.uuid(),
  /** Only "open-work" can be acknowledged; blocked work never can. */
  ack: z.literal("open-work").optional(),
});

export async function completeProjectAction(
  input: z.input<typeof completeSchema>,
): Promise<ActionResult> {
  const parsed = completeSchema.parse(input);
  const context = await requireWorkspace();

  const result = await completeProject(getDatabase(), context, {
    projectId: parsed.projectId,
    ...(parsed.ack ? { ack: parsed.ack } : {}),
  });

  revalidatePath("/projects");

  dispatchSoon();
  return toActionResult(result);
}

const idSchema = z.object({ projectId: z.uuid() });

export async function reopenProjectAction(
  input: z.input<typeof idSchema>,
): Promise<ActionResult> {
  const { projectId } = idSchema.parse(input);
  const context = await requireWorkspace();

  const result = await reopenProject(getDatabase(), context, projectId);
  revalidatePath("/projects");
  dispatchSoon();
  return toActionResult(result);
}

export async function deleteProjectAction(
  input: z.input<typeof idSchema>,
): Promise<ActionResult> {
  const { projectId } = idSchema.parse(input);
  const context = await requireWorkspace();

  const result = await deleteProject(getDatabase(), context, projectId);
  revalidatePath("/projects");
  dispatchSoon();

  // The rail must not keep pointing "Quadro" at a board that is gone.
  const jar = await cookies();
  if (jar.get(LAST_BOARD_COOKIE)?.value === projectId) jar.delete(LAST_BOARD_COOKIE);

  return toActionResult(result);
}

const moveSchema = z.object({
  projectId: z.uuid(),
  afterId: z.uuid().nullable().optional(),
  beforeId: z.uuid().nullable().optional(),
});

export async function moveProjectAction(
  input: z.input<typeof moveSchema>,
): Promise<ActionResult> {
  const parsed = moveSchema.parse(input);
  const context = await requireWorkspace();

  const result = await moveProject(getDatabase(), context, {
    projectId: parsed.projectId,
    afterId: parsed.afterId ?? null,
    beforeId: parsed.beforeId ?? null,
  });

  revalidatePath("/projects");

  dispatchSoon();
  return toActionResult(result);
}

/**
 * Server Actions cross the wire, so they answer with a plain object rather
 * than the domain's Result type — the class shape survives serialization, the
 * discriminated union is friendlier to read on the client.
 */
function toActionResult(
  result: Result<unknown, ProjectFailure>,
): ActionResult {
  if (!isRefused(result)) return { ok: true };
  return result.detail === undefined
    ? { ok: false, reason: result.reason }
    : { ok: false, reason: result.reason, detail: result.detail };
}
