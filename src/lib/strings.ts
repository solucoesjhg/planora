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
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type PasswordRefusal } from "@/domain/passwords";

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
 * The confirmation link carries a token to the login form, and signing in
 * there with the password chosen at sign-up is what confirms the address
 * (ADR 0007). The form owes the person a reason for asking.
 */
export const CONFIRMATION_PENDING =
  "Entre com a senha que você escolheu no cadastro para confirmar seu e-mail.";

export const CONFIRMATION_EXPIRED =
  "Este link de confirmação expirou ou não vale mais. Entre com sua senha: se o e-mail ainda não estiver confirmado, enviamos outro.";

/**
 * What a refused sign-in says, by the code Better Auth answers with. Its own
 * messages are in English, and "wrong password" means something else when the
 * form is confirming an address: the password is the one this account was
 * created with, which may not be the person's own.
 */
export const SIGN_IN_REFUSED = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  CONFIRMATION_PASSWORD_MISMATCH:
    "A senha não confere com a deste cadastro. Se você não lembra dela, ou não foi você quem criou a conta, use “Esqueci minha senha”: definir uma senha nova também confirma o e-mail.",
  EMAIL_NOT_VERIFIED:
    "Este e-mail ainda não foi confirmado. Enviamos um link novo para ele: abra-o e entre por lá.",
  FALLBACK: "Não foi possível entrar. Tente de novo em instantes.",
} as const;

/**
 * Why a password was refused, by the reason the policy names
 * (`src/domain/passwords.ts`, ADR 0008). The form shows it as the person types;
 * the server answers a submit with the same words.
 */
export const PASSWORD_REFUSALS: Record<PasswordRefusal, string> = {
  "too-short": `Use ao menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  "too-long": `Use no máximo ${MAX_PASSWORD_LENGTH} caracteres.`,
  "too-common": "Esta senha é uma das mais usadas do mundo. Escolha outra.",
  "contains-identity": "Evite usar seu nome ou e-mail dentro da senha.",
  // Not "one you never used": ten or more appearances means many people chose
  // it, not that this person did.
  breached:
    "Esta senha aparece muitas vezes em vazamentos públicos: é das primeiras que um invasor tenta. Escolha outra.",
};

/** What the password field says while nothing is wrong, or while it checks. */
export const PASSWORD_FEEDBACK = {
  hint: "Ao menos 8 caracteres. Uma frase que só você diria vale mais que símbolos.",
  checking: "Conferindo se esta senha aparece em vazamentos…",
  accepted: "Senha aceita.",
  /** The breach corpus could not be asked; the server decides at submit. */
  unavailable:
    "Não deu para consultar os vazamentos agora. A senha será conferida quando você enviar.",
} as const;

/**
 * The sign-up allowance counts accounts, not attempts (ADR 0008): a refused
 * password never spends it, so this is only ever read after five accepted
 * sign-ups from one connection inside a minute.
 */
export const SIGN_UP_RATE_LIMITED =
  "Muitos cadastros a partir desta conexão em pouco tempo. Espere um minuto e tente de novo.";

/**
 * The reset form keeps a counted limit: it guards the link's token, and it is
 * reached once per account (ADR 0008).
 */
export const RESET_RATE_LIMITED =
  "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
