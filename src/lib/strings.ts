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
