"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NOTIFIABLE_TYPES } from "@/lib/notifications";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { markRead, savePreferences } from "./repository";

export type NotificationActionResult = { readonly ok: true } | { readonly ok: false };

export async function markReadAction(input: { ids: readonly string[] | "all" }): Promise<NotificationActionResult> {
  const context = await requireWorkspace();
  const ids = input.ids === "all" ? "all" : z.array(z.uuid()).max(200).parse(input.ids);

  await markRead(getDatabase(), context, ids);
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

  await savePreferences(getDatabase(), context, parsed);
  revalidatePath("/settings/notifications");
  return { ok: true };
}
