"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  MAX_ACTIONS_PER_RULE,
  MAX_RULES_PER_WORKSPACE,
  type Action,
  type ActionType,
  type Condition,
  type ConditionField,
  type Trigger,
} from "@/domain/automations";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  ACTION_OPTIONS,
  CONDITION_FIELD_LABELS,
  PHASE_OPTIONS,
  PRIORITY_OPTIONS,
  RATE_LIMITED,
  TRIGGER_OPTIONS,
  VERDICT_OPTIONS,
} from "@/lib/strings";
import { createAutomationAction } from "@/server/modules/automations/actions";

export type Member = { readonly userId: string; readonly name: string };

/**
 * `when <event> · if <conditions> · then <actions>`, written by a person
 * (DEVELOPMENT_PLAN.md §7 Phase 9). The engine's vocabulary, no more: every
 * field, operator and action here is one the domain evaluates.
 */
export function RuleForm({ members }: { members: readonly Member[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("task.moved");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([{ type: "comment", body: "" }]);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    startTransition(async () => {
      const result = await createAutomationAction({ name, trigger, conditions, actions });
      if (!result.ok) {
        toast.add(
          result.reason === "forbidden"
            ? { title: "Seu papel neste espaço não permite criar regras." }
            : result.reason === "rate-limited"
              ? { title: RATE_LIMITED }
              : result.reason === "not-a-member"
                ? { title: "A regra cita alguém que não faz parte deste espaço." }
                : result.reason === "too-many-rules"
                  ? {
                      title: `Este espaço já tem ${MAX_RULES_PER_WORKSPACE} regras, o máximo.`,
                      description: "Apague uma que não use mais para criar outra.",
                    }
                  : { title: "A regra não está completa.", description: result.detail },
        );
        return;
      }
      toast.add({ title: "Regra criada", description: name });
      setName("");
      setConditions([]);
      setActions([{ type: "comment", body: "" }]);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-panel border border-line bg-panel p-4"
      data-testid="rule-form"
    >
      <Field label="Nome da regra">
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            placeholder="Ex.: Boas-vindas à execução"
          />
        )}
      </Field>

      <Field label="Quando">
        {(id) => (
          <Select
            id={id}
            items={TRIGGER_OPTIONS}
            value={trigger}
            onValueChange={(value) => setTrigger(value as Trigger)}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Se · {conditions.length === 0 ? "sempre" : `${conditions.length} condição(ões)`}
        </legend>
        {conditions.map((condition, index) => (
          <ConditionRow
            key={index}
            condition={condition}
            onChange={(next) =>
              setConditions(conditions.map((each, at) => (at === index ? next : each)))
            }
            onRemove={() => setConditions(conditions.filter((_, at) => at !== index))}
          />
        ))}
        {conditions.length < 5 ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setConditions([...conditions, { field: "priority", op: "is", value: "high" }])
              }
            >
              <Plus size={13} aria-hidden />
              Condição
            </Button>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Então · {actions.length} de {MAX_ACTIONS_PER_RULE}
        </legend>
        {actions.map((action, index) => (
          <ActionRow
            key={index}
            index={index}
            action={action}
            members={members}
            onChange={(next) => setActions(actions.map((each, at) => (at === index ? next : each)))}
            onRemove={
              actions.length > 1 ? () => setActions(actions.filter((_, at) => at !== index)) : null
            }
          />
        ))}
        {actions.length < MAX_ACTIONS_PER_RULE ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActions([...actions, { type: "comment", body: "" }])}
            >
              <Plus size={13} aria-hidden />
              Ação
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div>
        <Button type="submit" variant="primary" disabled={pending || name.trim().length === 0}>
          {pending ? "Criando…" : "Criar regra"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

const FIELD_OPTIONS = (Object.keys(CONDITION_FIELD_LABELS) as ConditionField[]).map((value) => ({
  value,
  label: CONDITION_FIELD_LABELS[value],
}));

const IS_OPTIONS = [
  { value: "is", label: "é" },
  { value: "is_not", label: "não é" },
];

const YES_NO = [
  { value: "true", label: "sim" },
  { value: "false", label: "não" },
];

function defaultCondition(field: ConditionField): Condition {
  switch (field) {
    case "priority":
      return { field, op: "is", value: "high" };
    case "phase":
    case "to_phase":
      return { field, op: "is", value: "execution" };
    case "blocked":
    case "assigned":
      return { field, op: "is", value: true };
    case "due_within_days":
      return { field, op: "lte", value: 2 };
    case "verdict":
      return { field, op: "is", value: "critical" };
  }
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="rule-condition">
      <Select
        aria-label="Campo"
        items={FIELD_OPTIONS}
        value={condition.field}
        onValueChange={(value) => onChange(defaultCondition(value as ConditionField))}
        className="w-44"
      />

      {condition.field === "priority" ||
      condition.field === "phase" ||
      condition.field === "to_phase" ||
      condition.field === "verdict" ? (
        <>
          <Select
            aria-label="Operador"
            items={IS_OPTIONS}
            value={condition.op}
            onValueChange={(value) => onChange({ ...condition, op: value as "is" | "is_not" } as Condition)}
            className="w-28"
          />
          <Select
            aria-label="Valor"
            items={
              condition.field === "priority"
                ? PRIORITY_OPTIONS
                : condition.field === "verdict"
                  ? VERDICT_OPTIONS
                  : PHASE_OPTIONS
            }
            value={condition.value}
            onValueChange={(value) => onChange({ ...condition, value } as Condition)}
            className="w-44"
          />
        </>
      ) : condition.field === "due_within_days" ? (
        <Input
          aria-label="Dias"
          type="number"
          min={0}
          max={365}
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: Number(event.target.value) || 0 })}
          className="w-24"
        />
      ) : (
        <Select
          aria-label="Valor"
          items={YES_NO}
          value={String(condition.value)}
          onValueChange={(value) => onChange({ ...condition, value: value === "true" } as Condition)}
          className="w-28"
        />
      )}

      <button
        type="button"
        aria-label="Remover condição"
        onClick={onRemove}
        className="rounded-control p-1.5 text-subtle hover:text-danger"
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function defaultAction(type: ActionType, members: readonly Member[]): Action {
  switch (type) {
    case "assign":
      return { type, userId: members[0]?.userId ?? "" };
    case "move":
      return { type, phase: "execution" };
    case "comment":
      return { type, body: "" };
    case "create_subtask":
      return { type, title: "" };
    case "set_priority":
      return { type, priority: "high" };
    case "notify":
      return { type, to: "assignees", message: "" };
  }
}

const NOTIFY_TO = [
  { value: "assignees", label: "os responsáveis" },
  { value: "managers", label: "quem gerencia o espaço" },
  { value: "user", label: "uma pessoa" },
];

function ActionRow({
  index,
  action,
  members,
  onChange,
  onRemove,
}: {
  index: number;
  action: Action;
  members: readonly Member[];
  onChange: (next: Action) => void;
  onRemove: (() => void) | null;
}) {
  const memberOptions = members.map((member) => ({ value: member.userId, label: member.name }));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="rule-action">
      <Select
        aria-label={`Ação ${index + 1}`}
        items={ACTION_OPTIONS}
        value={action.type}
        onValueChange={(value) => onChange(defaultAction(value as ActionType, members))}
        className="w-44"
      />

      {action.type === "assign" ? (
        <Select
          aria-label="Pessoa"
          items={memberOptions}
          value={action.userId}
          onValueChange={(value) => onChange({ ...action, userId: value })}
          className="w-44"
        />
      ) : action.type === "move" ? (
        <Select
          aria-label="Fase"
          items={PHASE_OPTIONS}
          value={action.phase}
          onValueChange={(value) => onChange({ ...action, phase: value as Action extends { phase: infer P } ? P : never })}
          className="w-44"
        />
      ) : action.type === "comment" ? (
        <Input
          aria-label="Comentário"
          value={action.body}
          onChange={(event) => onChange({ ...action, body: event.target.value })}
          maxLength={2000}
          placeholder="O que a regra escreve na tarefa"
          className="min-w-64 flex-1"
        />
      ) : action.type === "create_subtask" ? (
        <Input
          aria-label="Título da subtarefa"
          value={action.title}
          onChange={(event) => onChange({ ...action, title: event.target.value })}
          maxLength={200}
          placeholder="Título da subtarefa"
          className="min-w-64 flex-1"
        />
      ) : action.type === "set_priority" ? (
        <Select
          aria-label="Prioridade"
          items={PRIORITY_OPTIONS}
          value={action.priority}
          onValueChange={(value) => onChange({ ...action, priority: value as "high" | "medium" | "low" })}
          className="w-36"
        />
      ) : (
        <>
          <Select
            aria-label="Quem"
            items={NOTIFY_TO}
            value={action.to}
            onValueChange={(value) => {
              const to = value as "assignees" | "managers" | "user";
              const userId = action.userId ?? members[0]?.userId;
              onChange(
                to === "user" && userId
                  ? { type: "notify", to, userId, message: action.message }
                  : { type: "notify", to, message: action.message },
              );
            }}
            className="w-52"
          />
          {action.to === "user" ? (
            <Select
              aria-label="Pessoa"
              items={memberOptions}
              value={action.userId ?? members[0]?.userId ?? ""}
              onValueChange={(value) => onChange({ ...action, userId: value })}
              className="w-44"
            />
          ) : null}
          <Input
            aria-label="Mensagem"
            value={action.message}
            onChange={(event) => onChange({ ...action, message: event.target.value })}
            maxLength={500}
            placeholder="A mensagem do aviso"
            className="min-w-64 flex-1"
          />
        </>
      )}

      {onRemove ? (
        <button
          type="button"
          aria-label={`Remover ação ${index + 1}`}
          onClick={onRemove}
          className="rounded-control p-1.5 text-subtle hover:text-danger"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
