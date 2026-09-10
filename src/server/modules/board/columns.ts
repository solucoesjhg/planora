/**
 * Column use cases (DEVELOPMENT_PLAN.md §7 Phase 6).
 *
 * A column is not a list: it carries a typed phase, and the progress engine
 * reads that phase. So adding one means declaring which phase it belongs to,
 * and planning and done are immutable — `canEditColumn` is what says so, on the
 * server exactly as on the board.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { canEditColumn, keyBetween } from "@/domain/kanban";
import type { Phase } from "@/domain/types";
import { ok, refused, type Result } from "@/lib/result";
import { can, type TenantContext } from "@/server/auth/tenant";
import type { Database } from "@/server/db/client";
import { boardColumns, tasks } from "@/server/db/schema";

export type ColumnFailure =
  | "forbidden"
  | "not-found"
  | "immutable-column"
  | "phase-taken"
  | "not-empty";

export async function createColumn(
  db: Database,
  context: TenantContext,
  input: { projectId: string; name: string; phase: Phase },
): Promise<Result<{ columnId: string }, ColumnFailure>> {
  if (!can(context, "manage-column")) return refused("forbidden", context.role);

  // Planning and done are the ends of the board; there is exactly one of each.
  if (input.phase === "planning" || input.phase === "done") {
    return refused("phase-taken", input.phase);
  }

  return db.transaction(async (tx) => {
    const columns = await tx
      .select()
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.workspaceId, context.workspaceId),
          eq(boardColumns.projectId, input.projectId),
        ),
      )
      .orderBy(asc(boardColumns.position), asc(boardColumns.id));

    if (columns.length === 0) return refused("not-found", input.projectId);

    // A new column lands beside the others of its phase, so the board keeps
    // reading left to right as planning · execution · review · done.
    const lastOfPhase = [...columns]
      .reverse()
      .find((column) => column.phase === input.phase);
    const anchor = lastOfPhase ?? columns[0];
    const anchorIndex = columns.findIndex((column) => column.id === anchor?.id);
    const next = columns[anchorIndex + 1];

    const [created] = await tx
      .insert(boardColumns)
      .values({
        workspaceId: context.workspaceId,
        projectId: input.projectId,
        name: input.name.trim(),
        phase: input.phase,
        position: keyBetween(anchor?.position ?? null, next?.position ?? null),
      })
      .returning({ id: boardColumns.id });

    if (!created) throw new Error("column insert returned nothing");
    return ok({ columnId: created.id });
  });
}

export async function renameColumn(
  db: Database,
  context: TenantContext,
  input: { columnId: string; name: string },
): Promise<Result<{ columnId: string }, ColumnFailure>> {
  if (!can(context, "manage-column")) return refused("forbidden", context.role);

  const column = await findColumnRow(db, context, input.columnId);
  if (!column) return refused("not-found", input.columnId);

  // Renaming is allowed even on planning and done: what is immutable is their
  // phase and their place, not their label.
  const decision = canEditColumn(
    { id: column.id, phase: column.phase as Phase, position: column.position },
    "rename",
  );
  if (decision.kind === "refused") return refused("immutable-column", column.phase);

  await db
    .update(boardColumns)
    .set({ name: input.name.trim(), updatedAt: new Date() })
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.id, input.columnId),
      ),
    );

  return ok({ columnId: input.columnId });
}

export async function deleteColumn(
  db: Database,
  context: TenantContext,
  columnId: string,
): Promise<Result<{ columnId: string }, ColumnFailure>> {
  if (!can(context, "manage-column")) return refused("forbidden", context.role);

  const column = await findColumnRow(db, context, columnId);
  if (!column) return refused("not-found", columnId);

  const decision = canEditColumn(
    { id: column.id, phase: column.phase as Phase, position: column.position },
    "delete",
  );
  if (decision.kind === "refused") return refused("immutable-column", column.phase);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, context.workspaceId),
        eq(tasks.columnId, columnId),
        isNull(tasks.deletedAt),
      ),
    );

  // Deleting a column with cards in it would either orphan them or move them
  // silently. Neither is something to do behind someone's back.
  if (count > 0) return refused("not-empty", String(count));

  await db
    .delete(boardColumns)
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.id, columnId),
      ),
    );

  return ok({ columnId });
}

export async function moveColumn(
  db: Database,
  context: TenantContext,
  input: { columnId: string; afterId?: string | null; beforeId?: string | null },
): Promise<Result<{ position: string }, ColumnFailure>> {
  if (!can(context, "manage-column")) return refused("forbidden", context.role);

  const column = await findColumnRow(db, context, input.columnId);
  if (!column) return refused("not-found", input.columnId);

  const decision = canEditColumn(
    { id: column.id, phase: column.phase as Phase, position: column.position },
    "reorder",
  );
  if (decision.kind === "refused") return refused("immutable-column", column.phase);

  const siblings = await db
    .select()
    .from(boardColumns)
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.projectId, column.projectId),
      ),
    );

  const positionOf = (id: string | null | undefined) =>
    id ? (siblings.find((each) => each.id === id)?.position ?? null) : null;

  const lower = positionOf(input.afterId);
  const upper = positionOf(input.beforeId);

  // Planning stays first and done stays last, whatever the drop suggested.
  const planning = siblings.find((each) => each.phase === "planning");
  const done = siblings.find((each) => each.phase === "done");
  if (planning && lower === null) return refused("immutable-column", "planning");
  if (done && upper === null) return refused("immutable-column", "done");

  const position = keyBetween(lower, upper);
  await db
    .update(boardColumns)
    .set({ position, updatedAt: new Date() })
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.id, input.columnId),
      ),
    );

  return ok({ position });
}

async function findColumnRow(
  db: Database,
  context: TenantContext,
  columnId: string,
) {
  const [row] = await db
    .select()
    .from(boardColumns)
    .where(
      and(
        eq(boardColumns.workspaceId, context.workspaceId),
        eq(boardColumns.id, columnId),
      ),
    )
    .limit(1);

  return row ?? null;
}
