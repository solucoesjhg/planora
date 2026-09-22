/**
 * The interface's words for the code's values (DEVELOPMENT_PLAN.md Appendix B).
 *
 * The interface is pt-BR and everything else is English, and this is the one
 * module where the two meet: an enum value never reaches the screen unmapped,
 * and a pt-BR label never becomes an identifier. Appendix B is the dictionary
 * this file implements; a new concept enters both in the same pull request.
 *
 * The domain never imports this: it reasons in English and hands its results
 * to whoever renders them.
 */

import type { ActionType, ConditionField, Trigger } from "@/domain/automations";
import type {
  DimensionName,
  ProjectSignal,
  TaskSignal,
  Trend,
  Verdict,
} from "@/domain/health";
import type { Phase, Priority } from "@/domain/types";

export const PHASE_LABELS: Record<Phase, string> = {
  planning: "Planejamento",
  execution: "Execução",
  review: "Revisão",
  done: "Concluído",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  admin: "Admin",
  manager: "Gerente",
  member: "Membro",
  viewer: "Visitante",
};

/** A phase's label, for values that arrive as plain strings from a row. */
export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase as Phase] ?? phase;
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority as Priority] ?? priority;
}

/** The pairs a `<Select>` takes, in the order the interface shows them. */
export const PRIORITY_OPTIONS = (["high", "medium", "low"] as const).map(
  (value) => ({ value, label: PRIORITY_LABELS[value] }),
);

/* ------------------------------------------------------------------ *
 * Health (§3.5) — the badge, the five dimensions, the reasons
 * ------------------------------------------------------------------ */

export const VERDICT_LABELS: Record<Verdict, string> = {
  healthy: "Saudável",
  attention: "Atenção",
  at_risk: "Em risco",
  critical: "Crítico",
  insufficient_data: "Sem dados suficientes",
};

export const DIMENSION_LABELS: Record<DimensionName, string> = {
  flow: "Fluxo",
  pace: "Ritmo",
  punctuality: "Pontualidade",
  freshness: "Frescor",
  momentum: "Impulso",
};

/** The question each dimension answers, for the person reading the number. */
export const DIMENSION_HINTS: Record<DimensionName, string> = {
  flow: "quanto do trabalho aberto não está travado",
  pace: "se o progresso acompanha o calendário",
  punctuality: "quanto do trabalho com prazo está em dia",
  freshness: "quanto do trabalho continua se movendo",
  momentum: "se algo se moveu nos últimos sete dias",
};

/** Why a task is a bottleneck, or why the project as a whole is. */
export const SIGNAL_LABELS: Record<TaskSignal | ProjectSignal, string> = {
  blocked: "travada",
  late: "atrasada",
  stale: "estagnada",
  pace: "o progresso está atrás do calendário",
  momentum: "pouco movimento nos últimos sete dias",
};

/**
 * "1 dia", "5 dias" — a count of days that agrees with itself in pt-BR.
 * Every sentence that counts days reaches for this one rather than repeating
 * the plural, because the plural is a language rule and belongs here.
 */
export function dayCount(days: number): string {
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

/** "piorando há 5 dias" — the trend line under the badge. */
export function trendLabel(trend: Trend): string {
  if (trend.direction === "steady" || trend.days === 0) return "estável";
  const verb = trend.direction === "worsening" ? "piorando" : "melhorando";
  return `${verb} há ${dayCount(trend.days)}`;
}

/* ------------------------------------------------------------------ *
 * Automations (§7 Phase 9) — when · if · then
 * ------------------------------------------------------------------ */

export const TRIGGER_LABELS: Record<Trigger, string> = {
  "task.created": "uma tarefa é criada",
  "task.moved": "uma tarefa muda de coluna",
  "task.completed": "uma tarefa é concluída",
  "task.blocked": "uma tarefa é travada",
  "task.unblocked": "uma tarefa é destravada",
  "task.assigned": "uma tarefa recebe responsáveis",
  "comment.added": "alguém comenta numa tarefa",
  "dependency.resolved": "uma tarefa fica livre",
  "task.due_soon": "o prazo de uma tarefa se aproxima",
  "task.overdue": "o prazo de uma tarefa passa",
  "task.stalled": "uma tarefa estagna na coluna",
  "project.health_changed": "a saúde de um projeto muda",
};

export const CONDITION_FIELD_LABELS: Record<ConditionField, string> = {
  priority: "prioridade",
  phase: "fase atual",
  to_phase: "fase de destino",
  blocked: "travada",
  assigned: "tem responsável",
  due_within_days: "vence em até (dias)",
  verdict: "veredito",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  assign: "atribuir a",
  move: "mover para a fase",
  comment: "comentar",
  create_subtask: "criar subtarefa",
  set_priority: "definir prioridade",
  notify: "avisar",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  succeeded: "executada",
  failed: "falhou",
  skipped: "pulada",
};

/** The options a `<Select>` takes, in the order the interface shows them. */
export const TRIGGER_OPTIONS = (Object.keys(TRIGGER_LABELS) as Trigger[]).map((value) => ({
  value,
  label: TRIGGER_LABELS[value],
}));

export const ACTION_OPTIONS = (Object.keys(ACTION_LABELS) as ActionType[]).map((value) => ({
  value,
  label: ACTION_LABELS[value],
}));

export const PHASE_OPTIONS = (["planning", "execution", "review", "done"] as const).map(
  (value) => ({ value, label: PHASE_LABELS[value] }),
);

export const VERDICT_OPTIONS = (
  ["healthy", "attention", "at_risk", "critical", "insufficient_data"] as const
).map((value) => ({ value, label: VERDICT_LABELS[value] }));

/**
 * What a refused request says, when the refusal came from the allowance rather
 * than from the rule (§7 Phase 10). Every write action can answer with it, so
 * it lives here rather than in each screen's own map.
 */
export const RATE_LIMITED =
  "Você fez isso muitas vezes seguidas. Espere um minuto e tente de novo.";

/**
 * The verification link confirms an address and signs nobody in (ADR 0002's
 * sibling decision, `src/server/auth/config.ts`). It lands on the login form,
 * which owes the person an explanation for being there.
 */
export const VERIFIED_PARAM = "verificado";

export const EMAIL_VERIFIED =
  "E-mail confirmado. Entre com sua senha para continuar.";

/**
 * A link that did not work. Better Auth appends `error=<code>` to the callback
 * rather than replacing it, so the same page has to be able to say the
 * opposite of the line above — otherwise an expired link lands on a form
 * cheerfully announcing that the address was confirmed.
 */
export const VERIFICATION_FAILED: Record<string, string> = {
  TOKEN_EXPIRED: "Este link de confirmação expirou. Peça outro para continuar.",
  INVALID_TOKEN: "Este link de confirmação não vale mais. Peça outro para continuar.",
  USER_NOT_FOUND: "Não encontramos uma conta para este link.",
  INVALID_USER: "Este link é de outra conta. Saia e abra o link de novo.",
};

export const VERIFICATION_FAILED_FALLBACK =
  "Não deu para confirmar o e-mail com esse link. Peça outro para continuar.";
