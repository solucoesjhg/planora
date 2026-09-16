"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Action, Condition, Trigger } from "@/domain/automations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  ACTION_LABELS,
  CONDITION_FIELD_LABELS,
  PHASE_LABELS,
  PRIORITY_LABELS,
  TRIGGER_LABELS,
  VERDICT_LABELS,
} from "@/lib/strings";
import {
  deleteAutomationAction,
  setAutomationEnabledAction,
} from "@/server/modules/automations/actions";

export type RuleItem = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: Trigger;
  readonly conditions: readonly Condition[];
  readonly actions: readonly Action[];
};

export function RuleList({
  rules,
  members,
  mayManage,
}: {
  rules: readonly RuleItem[];
  members: readonly { userId: string; name: string }[];
  mayManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name ?? "alguém";

  function toggle(rule: RuleItem): void {
    startTransition(async () => {
      const result = await setAutomationEnabledAction({ automationId: rule.id, enabled: !rule.enabled });
      if (!result.ok) toast.add({ title: "Não deu para mudar a regra." });
      router.refresh();
    });
  }

  function remove(rule: RuleItem): void {
    startTransition(async () => {
      const result = await deleteAutomationAction({ automationId: rule.id });
      if (!result.ok) toast.add({ title: "Não deu para apagar a regra." });
      else toast.add({ title: `${rule.name} foi apagada.` });
      setConfirming(null);
      router.refresh();
    });
  }

  if (rules.length === 0) {
    return <p className="text-xs text-subtle">Nenhuma regra ainda.</p>;
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="rule-list">
      {rules.map((rule) => (
        <li
          key={rule.id}
          data-testid="rule"
          data-rule-name={rule.name}
          className={cn(
            "flex flex-col gap-2 rounded-card border border-line bg-card p-3",
            !rule.enabled && "opacity-60",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-[13px] font-medium text-primary">{rule.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge tone={rule.enabled ? "done" : "neutral"}>
                {rule.enabled ? "ligada" : "desligada"}
              </Badge>
              {mayManage ? (
                <>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    aria-label={`${rule.enabled ? "Desligar" : "Ligar"} ${rule.name}`}
                    disabled={pending}
                    onClick={() => toggle(rule)}
                    className={cn(
                      "relative h-5 w-9 rounded-full border transition-colors",
                      rule.enabled ? "border-sienna bg-sienna" : "border-line bg-card-hover",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-0.5 size-3.5 rounded-full bg-on-accent transition-[left]",
                        rule.enabled ? "left-4.5" : "left-0.5",
                      )}
                    />
                  </button>
                  {confirming === rule.id ? (
                    <Button variant="danger" size="sm" disabled={pending} onClick={() => remove(rule)}>
                      Confirmar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Apagar ${rule.name}`}
                      onClick={() => setConfirming(rule.id)}
                    >
                      <Trash2 size={13} aria-hidden />
                    </Button>
                  )}
                </>
              ) : null}
            </span>
          </div>

          <p className="text-xs text-secondary">
            <span className="text-subtle">Quando</span> {TRIGGER_LABELS[rule.trigger]}
            {rule.conditions.length > 0 ? (
              <>
                {" "}
                <span className="text-subtle">se</span>{" "}
                {rule.conditions.map(describeCondition).join(" e ")}
              </>
            ) : null}
            {" "}
            <span className="text-subtle">então</span>{" "}
            {rule.actions.map((action) => describeAction(action, nameOf)).join("; ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function describeCondition(condition: Condition): string {
  const field = CONDITION_FIELD_LABELS[condition.field];
  switch (condition.field) {
    case "priority":
      return `${field} ${condition.op === "is" ? "é" : "não é"} ${PRIORITY_LABELS[condition.value].toLowerCase()}`;
    case "phase":
    case "to_phase":
      return `${field} ${condition.op === "is" ? "é" : "não é"} ${PHASE_LABELS[condition.value]}`;
    case "verdict":
      return `${field} ${condition.op === "is" ? "é" : "não é"} ${VERDICT_LABELS[condition.value]}`;
    case "blocked":
    case "assigned":
      return `${field}: ${condition.value ? "sim" : "não"}`;
    case "due_within_days":
      return `${field} ${condition.value}`;
  }
}

function describeAction(action: Action, nameOf: (userId: string) => string): string {
  const label = ACTION_LABELS[action.type];
  switch (action.type) {
    case "assign":
      return `${label} ${nameOf(action.userId)}`;
    case "move":
      return `${label} ${PHASE_LABELS[action.phase]}`;
    case "comment":
      return `${label} "${action.body}"`;
    case "create_subtask":
      return `${label} "${action.title}"`;
    case "set_priority":
      return `${label} ${PRIORITY_LABELS[action.priority].toLowerCase()}`;
    case "notify":
      return `${label} ${
        action.to === "assignees"
          ? "os responsáveis"
          : action.to === "managers"
            ? "quem gerencia"
            : nameOf(action.userId ?? "")
      }: "${action.message}"`;
  }
}
