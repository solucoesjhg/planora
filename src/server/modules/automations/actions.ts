"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACTION_TYPES, CONDITION_FIELDS, TRIGGERS, type Action, type Condition } from "@/domain/automations";
import { VERDICTS } from "@/domain/health";
import { PHASES, PRIORITIES } from "@/domain/types";
import { isRefused } from "@/lib/result";
import { requireWorkspace } from "@/server/auth/dal";
import { writing, type Limited } from "@/server/limits";
import {
  createAutomation,
  deleteAutomation,
  updateAutomation,
  type AutomationFailure,
} from "./service";

export type AutomationActionResult<Value = undefined> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly reason: Limited<AutomationFailure>;
      readonly detail?: string;
    };

const uuid = z.uuid();

const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("priority"), op: z.enum(["is", "is_not"]), value: z.enum(PRIORITIES) }),
  z.object({ field: z.literal("phase"), op: z.enum(["is", "is_not"]), value: z.enum(PHASES) }),
  z.object({ field: z.literal("to_phase"), op: z.enum(["is", "is_not"]), value: z.enum(PHASES) }),
  z.object({ field: z.literal("blocked"), op: z.literal("is"), value: z.boolean() }),
  z.object({ field: z.literal("assigned"), op: z.literal("is"), value: z.boolean() }),
  z.object({ field: z.literal("due_within_days"), op: z.literal("lte"), value: z.number().int().min(0).max(365) }),
  z.object({ field: z.literal("verdict"), op: z.enum(["is", "is_not"]), value: z.enum(VERDICTS) }),
]);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), userId: uuid }),
  z.object({ type: z.literal("move"), phase: z.enum(PHASES) }),
  z.object({ type: z.literal("comment"), body: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("create_subtask"), title: z.string().min(1).max(200) }),
  z.object({ type: z.literal("set_priority"), priority: z.enum(PRIORITIES) }),
  z.object({
    type: z.literal("notify"),
    to: z.enum(["assignees", "managers", "user"]),
    userId: uuid.optional(),
    message: z.string().min(1).max(500),
  }),
]);

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger: z.enum(TRIGGERS),
  conditions: z.array(conditionSchema).max(5),
  actions: z.array(actionSchema).min(1).max(10),
});

// The literal unions above are the domain's; this keeps the two from drifting.
void CONDITION_FIELDS;
void ACTION_TYPES;

export async function createAutomationAction(
  input: z.input<typeof ruleSchema>,
): Promise<AutomationActionResult<{ automationId: string }>> {
  const parsed = ruleSchema.parse(input);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    createAutomation(tx, context, {
      name: parsed.name,
      trigger: parsed.trigger,
      conditions: parsed.conditions as Condition[],
      actions: parsed.actions as Action[],
    }),
  );
  if (isRefused(result)) return failure(result);

  revalidatePath("/settings/automations");
  return { ok: true, value: result.value };
}

export async function setAutomationEnabledAction(input: {
  automationId: string;
  enabled: boolean;
}): Promise<AutomationActionResult> {
  const automationId = uuid.parse(input.automationId);
  const context = await requireWorkspace();

  const enabled = z.boolean().parse(input.enabled);
  const result = await writing(context, "write", (tx) =>
    updateAutomation(tx, context, automationId, { enabled }),
  );
  if (isRefused(result)) return failure(result);

  revalidatePath("/settings/automations");
  return { ok: true, value: undefined };
}

export async function deleteAutomationAction(input: {
  automationId: string;
}): Promise<AutomationActionResult> {
  const automationId = uuid.parse(input.automationId);
  const context = await requireWorkspace();

  const result = await writing(context, "write", (tx) =>
    deleteAutomation(tx, context, automationId),
  );
  if (isRefused(result)) return failure(result);

  revalidatePath("/settings/automations");
  return { ok: true, value: undefined };
}

function failure(result: {
  reason: Limited<AutomationFailure>;
  detail?: string;
}): AutomationActionResult<never> {
  return result.detail === undefined
    ? { ok: false, reason: result.reason }
    : { ok: false, reason: result.reason, detail: result.detail };
}
