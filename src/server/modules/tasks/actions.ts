"use server";

import { revalidatePath } from "next/cache";
import { dispatchSoon } from "@/server/events/dispatch-soon";
import { z } from "zod";
import { PRIORITIES } from "@/domain/types";
import { isRefused } from "@/lib/result";
import { requireWorkspace } from "@/server/auth/dal";
import { consumeAllowance, writing, type Limited } from "@/server/limits";
import { getStorage } from "@/server/storage";
import {
  attachmentUrl,
  confirmUpload,
  removeAttachment,
  requestUpload,
  type AttachmentFailure,
} from "./attachments";
import {
  addChecklistItem,
  addComment,
  addDependency,
  assignTask,
  createTask,
  editComment,
  removeChecklistItem,
  removeComment,
  removeDependency,
  setChecklistItem,
  updateTask,
  type AssignFailure,
  type DependencyFailure,
  type TaskFailure,
} from "./service";

export type ActionResult<Failure, Value = undefined> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: Failure; readonly detail?: string };

/**
 * Every action here writes, so every one of them goes through `writing`: the
 * allowance first, the scope second, and the service underneath handed the
 * transaction it opened (ADR 0002, §7 Phase 10). A refused request never opens
 * a transaction, which is why `rate-limited` joins each failure type rather
 * than arriving as a thrown error.
 *
 * All fourteen count against the `write` allowance. None of them reaches
 * anybody's inbox by itself: an assignment leaves an event, and it is the
 * dispatcher that decides whether an email follows.
 */

const uuid = z.uuid();
const priority = z.enum(PRIORITIES);
const isoDate = z.iso.date().nullable();

/** The board and the document both show the task, so both are revalidated. */
function refresh(projectId: string, taskId?: string): void {
  revalidatePath(`/projects/${projectId}`);
  if (taskId) revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  dispatchSoon();
}

const createSchema = z.object({
  projectId: uuid,
  columnId: uuid,
  title: z.string().min(1).max(200),
  priority: priority.optional(),
});

export async function createTaskAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<Limited<TaskFailure>, { taskId: string; number: number }>> {
  const parsed = createSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    createTask(tx, context, parsed),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId);
  return { ok: true, value: result.value };
}

const updateSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  title: z.string().max(200).optional(),
  body: z.string().max(200_000).optional(),
  internalNotes: z.string().max(200_000).optional(),
  priority: priority.optional(),
  startDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  blocked: z.boolean().optional(),
  blockReason: z.string().max(500).nullable().optional(),
});

export async function updateTaskAction(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult<Limited<TaskFailure>>> {
  const parsed = updateSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    updateTask(tx, context, {
      taskId: parsed.taskId,
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(parsed.body === undefined ? {} : { body: parsed.body }),
      ...(parsed.internalNotes === undefined
        ? {}
        : { internalNotes: parsed.internalNotes }),
      ...(parsed.priority === undefined ? {} : { priority: parsed.priority }),
      ...(parsed.startDate === undefined ? {} : { startDate: parsed.startDate }),
      ...(parsed.dueDate === undefined ? {} : { dueDate: parsed.dueDate }),
      ...(parsed.blocked === undefined ? {} : { blocked: parsed.blocked }),
      ...(parsed.blockReason === undefined ? {} : { blockReason: parsed.blockReason }),
    }),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------------ *
 * Assignees
 * ------------------------------------------------------------------ */

const assignSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  userIds: z.array(uuid).max(50),
});

export async function setAssigneesAction(
  input: z.input<typeof assignSchema>,
): Promise<ActionResult<Limited<AssignFailure>>> {
  const parsed = assignSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    assignTask(tx, context, {
      taskId: parsed.taskId,
      userIds: parsed.userIds,
    }),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------------ *
 * Checklist
 * ------------------------------------------------------------------ */

const checklistAddSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  title: z.string().min(1).max(200),
});

export async function addChecklistItemAction(
  input: z.input<typeof checklistAddSchema>,
): Promise<ActionResult<Limited<TaskFailure>, { itemId: string }>> {
  const parsed = checklistAddSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    addChecklistItem(tx, context, parsed),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: result.value };
}

const checklistSetSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  itemId: uuid,
  done: z.boolean().optional(),
  title: z.string().max(200).optional(),
});

export async function setChecklistItemAction(
  input: z.input<typeof checklistSetSchema>,
): Promise<ActionResult<Limited<TaskFailure>, { checklistCompleted: boolean }>> {
  const parsed = checklistSetSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    setChecklistItem(tx, context, {
      itemId: parsed.itemId,
      ...(parsed.done === undefined ? {} : { done: parsed.done }),
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
    }),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: { checklistCompleted: result.value.checklistCompleted } };
}

const checklistRemoveSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  itemId: uuid,
});

export async function removeChecklistItemAction(
  input: z.input<typeof checklistRemoveSchema>,
): Promise<ActionResult<Limited<TaskFailure>>> {
  const parsed = checklistRemoveSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    removeChecklistItem(tx, context, parsed.itemId),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------------ *
 * Dependencies
 * ------------------------------------------------------------------ */

const dependencySchema = z.object({
  projectId: uuid,
  taskId: uuid,
  dependsOnId: uuid,
});

export async function addDependencyAction(
  input: z.input<typeof dependencySchema>,
): Promise<ActionResult<Limited<DependencyFailure>>> {
  const parsed = dependencySchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    addDependency(tx, context, {
      taskId: parsed.taskId,
      dependsOnId: parsed.dependsOnId,
    }),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

const dependencyRemoveSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  dependencyId: uuid,
});

export async function removeDependencyAction(
  input: z.input<typeof dependencyRemoveSchema>,
): Promise<ActionResult<Limited<TaskFailure>>> {
  const parsed = dependencyRemoveSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    removeDependency(tx, context, parsed.dependencyId),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------ */

const commentSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  body: z.string().min(1).max(50_000),
});

export async function addCommentAction(
  input: z.input<typeof commentSchema>,
): Promise<ActionResult<Limited<TaskFailure>, { commentId: string }>> {
  const parsed = commentSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    addComment(tx, context, {
      taskId: parsed.taskId,
      body: parsed.body,
    }),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: result.value };
}

const commentEditSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  commentId: uuid,
  body: z.string().min(1).max(50_000),
});

export async function editCommentAction(
  input: z.input<typeof commentEditSchema>,
): Promise<ActionResult<Limited<TaskFailure>>> {
  const parsed = commentEditSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    editComment(tx, context, {
      commentId: parsed.commentId,
      body: parsed.body,
    }),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

const commentRemoveSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  commentId: uuid,
});

export async function removeCommentAction(
  input: z.input<typeof commentRemoveSchema>,
): Promise<ActionResult<Limited<TaskFailure>>> {
  const parsed = commentRemoveSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    removeComment(tx, context, parsed.commentId),
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId);
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ *
 *
 * These three are the exception to `writing`, and the reason is in
 * `attachments.ts`: each of them waits on the store between two statements, so
 * there is no single scope to put them in. They take the allowance themselves
 * — the same counter, the same bucket, in the same place in the order — and
 * hand the pool to a function that opens a scope per statement instead.
 */

const uploadSchema = z.object({
  projectId: uuid,
  taskId: uuid.nullable(),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
});

export async function requestUploadAction(
  input: z.input<typeof uploadSchema>,
): Promise<
  ActionResult<
    Limited<AttachmentFailure>,
    {
      attachmentId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
    }
  >
> {
  const parsed = uploadSchema.parse(input);
  const context = await requireWorkspace();

  const allowance = await consumeAllowance("write", context.userId);
  if (isRefused(allowance)) return failure(allowance);

  const result = await requestUpload(null, context, getStorage(), parsed);
  if (isRefused(result)) return failure(result);

  return {
    ok: true,
    value: {
      attachmentId: result.value.attachmentId,
      url: result.value.ticket.url,
      method: result.value.ticket.method,
      headers: result.value.ticket.headers,
    },
  };
}

const confirmSchema = z.object({
  projectId: uuid,
  taskId: uuid.nullable(),
  attachmentId: uuid,
});

export async function confirmUploadAction(
  input: z.input<typeof confirmSchema>,
): Promise<ActionResult<Limited<AttachmentFailure>, { url: string }>> {
  const parsed = confirmSchema.parse(input);
  const context = await requireWorkspace();

  const allowance = await consumeAllowance("write", context.userId);
  if (isRefused(allowance)) return failure(allowance);

  const confirmed = await confirmUpload(
    null,
    context,
    getStorage(),
    parsed.attachmentId,
  );
  if (isRefused(confirmed)) return failure(confirmed);

  refresh(parsed.projectId, parsed.taskId ?? undefined);
  // The stable address, not a signed URL: an image dropped into a task body is
  // stored with this `src` and has to still load long after any signature has
  // expired.
  return { ok: true, value: { url: attachmentUrl(parsed.attachmentId) } };
}

const attachmentSchema = z.object({
  projectId: uuid,
  taskId: uuid.nullable(),
  attachmentId: uuid,
});

export async function removeAttachmentAction(
  input: z.input<typeof attachmentSchema>,
): Promise<ActionResult<Limited<AttachmentFailure>>> {
  const parsed = attachmentSchema.parse(input);
  const context = await requireWorkspace();

  const allowance = await consumeAllowance("write", context.userId);
  if (isRefused(allowance)) return failure(allowance);

  const result = await removeAttachment(
    null,
    context,
    getStorage(),
    parsed.attachmentId,
  );
  if (isRefused(result)) return failure(result);

  refresh(parsed.projectId, parsed.taskId ?? undefined);
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

function failure<Reason extends string>(result: {
  reason: Reason;
  detail?: string;
}): { ok: false; reason: Reason; detail?: string } {
  return result.detail === undefined
    ? { ok: false, reason: result.reason }
    : { ok: false, reason: result.reason, detail: result.detail };
}

