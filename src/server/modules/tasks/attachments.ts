/**
 * Attachments (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * Three steps, and the middle one does not involve this application at all:
 *
 *   1. `requestUpload` checks the workspace, the type and the size, writes a
 *      `pending` row and hands back a URL that expires.
 *   2. The browser sends the bytes straight to the store.
 *   3. `confirmUpload` asks the store what actually landed — size, type,
 *      checksum — and only then does the row become `stored`.
 *
 * A reader's URL is signed the same way, and only after the workspace check:
 * `linkFor` is the one door, and it expires on its own.
 */

import { and, eq } from "drizzle-orm";
import { ok, refused, type Result } from "@/lib/result";
import { newId } from "@/lib/id";
import { can, type TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { attachments } from "@/server/db/schema";
import type { Storage, UploadTicket } from "@/server/storage";
import { findTask } from "./repository";

export type AttachmentFailure =
  | "forbidden"
  | "not-found"
  | "unsupported-type"
  | "too-large"
  | "missing";

/** 25 MB — a photograph of a wall, a PDF of a quote, a spreadsheet. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** No SVG: it is a document that can carry script, not a picture. */
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const IMAGE_MIME_TYPES = ALLOWED_MIME_TYPES.filter((mime) =>
  mime.startsWith("image/"),
);

export type RequestUploadInput = {
  readonly projectId: string;
  readonly taskId: string | null;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
};

export async function requestUpload(
  db: Database,
  context: TenantContext,
  storage: Storage,
  input: RequestUploadInput,
): Promise<
  Result<{ attachmentId: string; ticket: UploadTicket }, AttachmentFailure>
> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  if (!ALLOWED_MIME_TYPES.includes(input.mime as (typeof ALLOWED_MIME_TYPES)[number])) {
    return refused("unsupported-type", input.mime);
  }
  // The declared size is a courtesy check; `confirmUpload` measures what landed.
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return refused("too-large", String(input.size));
  }

  if (input.taskId) {
    const task = await findTask(db, context, input.taskId);
    if (!task || task.projectId !== input.projectId) {
      return refused("not-found", input.taskId);
    }
  }

  const attachmentId = newId();
  const path = objectPath(context.workspaceId, input.projectId, attachmentId, input.name);

  await db.insert(attachments).values({
    id: attachmentId,
    workspaceId: context.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    bucket: storage.bucket,
    path,
    name: safeName(input.name),
    mime: input.mime,
    size: input.size,
    uploadedBy: context.userId,
  });

  return ok({ attachmentId, ticket: await storage.upload(path, input.mime) });
}

export async function confirmUpload(
  db: Database,
  context: TenantContext,
  storage: Storage,
  attachmentId: string,
): Promise<
  Result<{ attachmentId: string; size: number; checksum: string }, AttachmentFailure>
> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const row = await findAttachment(db, context, attachmentId);
  if (!row) return refused("not-found", attachmentId);

  const stored = await storage.head(row.path);
  if (!stored) return refused("missing", row.path);

  // What the store holds, not what the browser claimed it would send.
  if (stored.size > MAX_ATTACHMENT_BYTES) {
    await storage.remove(row.path);
    await db
      .delete(attachments)
      .where(
        and(
          eq(attachments.workspaceId, context.workspaceId),
          eq(attachments.id, attachmentId),
        ),
      );
    return refused("too-large", String(stored.size));
  }

  await db
    .update(attachments)
    .set({
      status: "stored",
      size: stored.size,
      checksum: stored.checksum,
      storedAt: new Date(),
    })
    .where(
      and(
        eq(attachments.workspaceId, context.workspaceId),
        eq(attachments.id, attachmentId),
      ),
    );

  return ok({ attachmentId, size: stored.size, checksum: stored.checksum });
}

/**
 * A URL that reads the bytes, good for `seconds`. The workspace check happens
 * here, before the signature exists — which is the whole point of the private
 * bucket.
 */
export async function linkFor(
  db: Database,
  context: TenantContext,
  storage: Storage,
  attachmentId: string,
  seconds = 5 * 60,
): Promise<Result<{ url: string; expiresAt: Date }, AttachmentFailure>> {
  const row = await findAttachment(db, context, attachmentId);
  if (!row) return refused("not-found", attachmentId);

  return ok({
    url: await storage.signedUrl(row.path, seconds),
    expiresAt: new Date(Date.now() + seconds * 1000),
  });
}

export async function removeAttachment(
  db: Database,
  context: TenantContext,
  storage: Storage,
  attachmentId: string,
): Promise<Result<{ attachmentId: string }, AttachmentFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const row = await findAttachment(db, context, attachmentId);
  if (!row) return refused("not-found", attachmentId);

  // The bytes first: a row without an object is a broken card, an object
  // without a row is a leak nobody can see.
  await storage.remove(row.path);
  await db
    .delete(attachments)
    .where(
      and(
        eq(attachments.workspaceId, context.workspaceId),
        eq(attachments.id, attachmentId),
      ),
    );

  return ok({ attachmentId });
}

export async function findAttachment(
  db: Database,
  context: TenantContext,
  attachmentId: string,
): Promise<typeof attachments.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.workspaceId, context.workspaceId),
        eq(attachments.id, attachmentId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/* ------------------------------------------------------------------ *
 * Naming
 * ------------------------------------------------------------------ */

/** The tenant is visible in the path, so a stray object is traceable. */
function objectPath(
  workspaceId: string,
  projectId: string,
  attachmentId: string,
  name: string,
): string {
  return `${workspaceId}/${projectId}/${attachmentId}/${safeName(name)}`;
}

/**
 * A file name a person chose, reduced to something that cannot travel: no
 * separators, no leading dots, nothing that would read as a path segment.
 */
export function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replaceAll(/[^\w.\- ]+/g, "-")
    .replaceAll(/\s+/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(-120);

  return cleaned.length > 0 ? cleaned : "arquivo";
}
