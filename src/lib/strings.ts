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

/** "piorando há 5 dias" — the trend line under the badge. */
export function trendLabel(trend: Trend): string {
  if (trend.direction === "steady" || trend.days === 0) return "estável";
  const verb = trend.direction === "worsening" ? "piorando" : "melhorando";
  return `${verb} há ${trend.days} ${trend.days === 1 ? "dia" : "dias"}`;
}
