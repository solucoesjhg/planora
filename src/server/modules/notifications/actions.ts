"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NOTIFIABLE_TYPES } from "@/lib/notifications";
import { ok, isRefused, type Result } from "@/lib/result";
import { requireWorkspace } from "@/server/auth/dal";
import { writing, type Limited } from "@/server/limits";
import { markRead, savePreferences } from "./repository";

/**
 * Neither of these two can be refused on its merits — reading your own inbox
 * and choosing your own channels are yours to do — so the only reason that
 * ever comes back is the limit's (§7 Phase 10).
 */
export type NotificationActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Limited<never> };

export async function markReadAction(input: { ids: readonly string[] | "all" }): Promise<NotificationActionResult> {
  const context = await requireWorkspace();
  const ids = input.ids === "all" ? "all" : z.array(z.uuid()).max(200).parse(input.ids);

  const result = await writing(
    context,
    "write",
    async (tx): Promise<Result<undefined, never>> => {
      await markRead(tx, context, ids);
      return ok(undefined);
    },
  );
  if (isRefused(result)) return { ok: false, reason: result.reason };

  revalidatePath("/inbox");
  revalidatePath("/", "layout");
  return { ok: true };
}

const channelsSchema = z.partialRecord(
  z.enum(NOTIFIABLE_TYPES),
  z.object({ inApp: z.boolean().optional(), email: z.boolean().optional() }),
);

const preferencesSchema = z.object({
  channels: channelsSchema,
  digest: z.enum(["none", "daily", "weekly"]),
});

export async function savePreferencesAction(
  input: z.input<typeof preferencesSchema>,
): Promise<NotificationActionResult> {
  const parsed = preferencesSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(
    context,
    "write",
    async (tx): Promise<Result<undefined, never>> => {
      await savePreferences(tx, context, parsed);
      return ok(undefined);
    },
  );
  if (isRefused(result)) return { ok: false, reason: result.reason };

  revalidatePath("/settings/notifications");
  return { ok: true };
}
