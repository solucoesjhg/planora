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
 *
 * All four of these cross the network between two statements, which is the one
 * thing a scope may not span (ADR 0002): a pooled backend held open while we
 * wait on the store is idle in transaction, and `planora_app` is given ten
 * seconds of that before Postgres takes the connection away. So each reads in
 * one scope, asks the store outside every scope, and writes in another — which
 * is why these four, alone among the module's functions, are not handed the
 * Server Action's transaction. They are handed `null` and open a scope per
 * statement through the lane itself. A caller that does lend them one gets the
 * old shape back, with the store's round trip inside it.
 */

import { and, eq } from "drizzle-orm";
import { isRefused, ok, refused, type Result } from "@/lib/result";
import { newId } from "@/lib/id";
import { can, type TenantContext } from "@/server/auth/tenant";
import {
  inScope,
  withTenant,
  type Executor,
  type Transaction,
} from "@/server/db/client";
import { attachments } from "@/server/db/schema";
import type { Storage, UploadTicket } from "@/server/storage";
import { findTask } from "./repository";

export type AttachmentFailure =
  | "forbidden"
  | "not-found"
  | "unsupported-type"
  | "too-large"
  | "missing"
  /** The store threw. Not the file, not the person: the cause is in the log. */
  | "storage-unavailable";

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

/**
 * Where an attachment lives, as far as the rest of the application is
 * concerned. Stable: it goes into a task's body and has to still work next
 * year. The signed URL is what this address redirects to, freshly, on each
 * request — after the workspace check.
 */
export function attachmentUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}`;
}

/**
 * A connection these four may borrow: the scope a caller is already in, or
 * `null` from the one place that has none to lend.
 *
 * The Server Action passes `null` — it opened no scope precisely so that the
 * store can be reached between statements — and each step then opens the
 * lane's own. What does pass something is the route that serves a file, which
 * is inside its own scope already, and the suite, which has a connection of
 * its own and would otherwise watch its writes land in another database.
 */
export type Borrowed = Executor | null;

function step<T>(
  db: Borrowed,
  context: TenantContext,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db ? inScope(db, context, run) : withTenant(context, run);
}

export type RequestUploadInput = {
  readonly projectId: string;
  readonly taskId: string | null;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
};

export async function requestUpload(
  db: Borrowed,
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

  const taskId = input.taskId;
  if (taskId) {
    const task = await step(db, context, (tx) => findTask(tx, context, taskId));
    if (!task || task.projectId !== input.projectId) {
      return refused("not-found", taskId);
    }
  }

  const attachmentId = newId();
  const path = objectPath(context.workspaceId, input.projectId, attachmentId, input.name);

  // The ticket before the row: a row for an upload that can never be made
  // would sit at `pending` for good. That order is unchanged; what the scopes
  // add is that the check above has already committed when the store is asked,
  // so a ticket that never turns into a row leaves nothing behind but an
  // address nobody was given.
  const ticket = await askStore("issue an upload ticket", () =>
    storage.upload(path, input.mime),
  );
  if (isRefused(ticket)) return ticket;

  await step(db, context, async (tx) => {
    await tx.insert(attachments).values({
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
  });

  return ok({ attachmentId, ticket: ticket.value });
}

export async function confirmUpload(
  db: Borrowed,
  context: TenantContext,
  storage: Storage,
  attachmentId: string,
): Promise<
  Result<{ attachmentId: string; size: number; checksum: string }, AttachmentFailure>
> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const row = await step(db, context, (tx) =>
    findAttachment(tx, context, attachmentId),
  );
  if (!row) return refused("not-found", attachmentId);

  const asked = await askStore("say what landed", () => storage.head(row.path));
  if (isRefused(asked)) return asked;
  const stored = asked.value;
  if (!stored) return refused("missing", row.path);

  // What the store holds, not what the browser claimed it would send. The
  // object goes first and the row after, as before: the row still says
  // `pending` while the object is being taken away, and a `pending` row whose
  // object is gone is what the second step reads as `missing`.
  if (stored.size > MAX_ATTACHMENT_BYTES) {
    const removed = await askStore("remove an oversized object", () =>
      storage.remove(row.path),
    );
    if (isRefused(removed)) return removed;
    await step(db, context, async (tx) => {
      await tx
        .delete(attachments)
        .where(
          and(
            eq(attachments.workspaceId, context.workspaceId),
            eq(attachments.id, attachmentId),
          ),
        );
    });
    return refused("too-large", String(stored.size));
  }

  await step(db, context, async (tx) => {
    await tx
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
  });

  return ok({ attachmentId, size: stored.size, checksum: stored.checksum });
}

/**
 * A URL that reads the bytes, good for `seconds`. The workspace check happens
 * here, before the signature exists — which is the whole point of the private
 * bucket.
 *
 * The check and the signature are two steps on purpose: handed nothing to
 * borrow, the row is read in a scope that has committed before the store is
 * asked to sign, so nothing holds a backend while it does. Handed a
 * transaction — which is what `/api/attachments/[attachmentId]` lends it
 * today — the signature happens with that scope still open, which is the one
 * thing ADR 0002 asks a caller of this module not to do.
 */
export async function linkFor(
  db: Borrowed,
  context: TenantContext,
  storage: Storage,
  attachmentId: string,
  seconds = 5 * 60,
): Promise<Result<{ url: string; expiresAt: Date }, AttachmentFailure>> {
  const row = await step(db, context, (tx) =>
    findAttachment(tx, context, attachmentId),
  );
  if (!row) return refused("not-found", attachmentId);

  const url = await askStore("sign a link", () => storage.signedUrl(row.path, seconds));
  if (isRefused(url)) return url;

  return ok({ url: url.value, expiresAt: new Date(Date.now() + seconds * 1000) });
}

export async function removeAttachment(
  db: Borrowed,
  context: TenantContext,
  storage: Storage,
  attachmentId: string,
): Promise<Result<{ attachmentId: string }, AttachmentFailure>> {
  if (!can(context, "write-task")) return refused("forbidden", context.role);

  const row = await step(db, context, (tx) =>
    findAttachment(tx, context, attachmentId),
  );
  if (!row) return refused("not-found", attachmentId);

  // The bytes first: a row without an object is a broken card, an object
  // without a row is a leak nobody can see. Reading the path and deleting the
  // row are two scopes now, which is the same trade seen from the other side:
  // between them the object is already gone, and the card is broken until the
  // delete commits.
  const removed = await askStore("remove an object", () => storage.remove(row.path));
  if (isRefused(removed)) return removed;
  await step(db, context, async (tx) => {
    await tx
      .delete(attachments)
      .where(
        and(
          eq(attachments.workspaceId, context.workspaceId),
          eq(attachments.id, attachmentId),
        ),
      );
  });

  return ok({ attachmentId });
}

export async function findAttachment(
  db: Executor,
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
 * The store
 * ------------------------------------------------------------------ */

/**
 * The store is the one dependency in this module that is not ours: a bucket
 * nobody created, a key pasted wrong, a network that is down. Each of those
 * used to throw — and a Server Action that throws reaches the browser as a
 * rejected promise with its message stripped, which is how "Enviando…" came to
 * stay on the screen for good on the first production deploy. The store's
 * failure becomes a refusal the interface can name; the log keeps the cause.
 */
async function askStore<Value>(
  what: string,
  work: () => Promise<Value>,
): Promise<Result<Value, "storage-unavailable">> {
  try {
    return ok(await work());
  } catch (error) {
    console.error(`[attachments] the store failed to ${what}:`, error);
    return refused(
      "storage-unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
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
