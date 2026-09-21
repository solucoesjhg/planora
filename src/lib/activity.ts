/**
 * One line of the activity feed, in the interface's words.
 *
 * The event catalogue (§4.5) is English and so are its payloads; this is
 * where an entry becomes a sentence a person reads. Pure, so the sentences
 * can be tested without a database.
 *
 * The map is total over `EventType` (§7 Phase 10, "complete activity_logs
 * coverage"). The dispatcher already writes a row for every catalogued
 * event, so a verb without a sentence here is not a missing row — it is a
 * row that reaches the feed as its own identifier: `Planora · task.overdue`,
 * which is how the clock's three events read before this map existed. Making
 * the type total is what keeps that from happening again: a new event stops
 * the typecheck here rather than leaking English into a pt-BR feed.
 */

import type { Verdict } from "@/domain/health";
import type { EventType } from "./events";
import { VERDICT_LABELS, dayCount, phaseLabel } from "./strings";

export type ActivityLine = {
  readonly verb: string;
  readonly actorKind: string;
  readonly actorName: string | null;
  readonly taskNumber: number | null;
  readonly taskTitle: string | null;
  readonly projectName: string | null;
  readonly columnName: string | null;
  readonly data: Record<string, unknown>;
};

type Sentence = (line: ActivityLine) => string;

const SENTENCE_OF: Record<EventType, Sentence> = {
  "project.created": (line) => `${actorOf(line)} criou o projeto ${projectOf(line)}`,
  "project.completed": (line) => `${actorOf(line)} concluiu o projeto ${projectOf(line)}`,
  "project.reopened": (line) => `${actorOf(line)} reabriu o projeto ${projectOf(line)}`,

  "task.created": (line) => `${actorOf(line)} criou ${taskOf(line)}${titleOf(line)}`,
  "task.moved": (line) => {
    const to = line.columnName ?? phaseOf(line.data["toPhase"]);
    return to
      ? `${actorOf(line)} moveu ${taskOf(line)} para ${to}`
      : `${actorOf(line)} moveu ${taskOf(line)}`;
  },
  "task.blocked": (line) => `${actorOf(line)} travou ${taskOf(line)}`,
  "task.unblocked": (line) => `${actorOf(line)} destravou ${taskOf(line)}`,
  "task.completed": (line) => `${actorOf(line)} concluiu ${taskOf(line)}${titleOf(line)}`,
  "task.assigned": (line) => {
    const names = namesOf(line.data["names"]);
    return names.length === 0
      ? `${actorOf(line)} tirou os responsáveis de ${taskOf(line)}`
      : `${actorOf(line)} atribuiu ${taskOf(line)} a ${names.join(", ")}`;
  },
  "checklist.completed": (line) => `${actorOf(line)} fechou o checklist de ${taskOf(line)}`,
  "comment.added": (line) => `${actorOf(line)} comentou em ${taskOf(line)}`,
  "dependency.resolved": (line) =>
    `${taskOf(line)} ficou livre: o que ela esperava foi concluído`,

  "project.health_changed": (line) =>
    `${projectOf(line)} passou de ${verdictOf(line.data["from"])} para ${verdictOf(line.data["to"])}`,
  "member.invited": (line) =>
    `${actorOf(line)} convidou ${stringOf(line.data["email"]) ?? "alguém"}`,

  // The clock's events are about the task, not about who did it: nobody did
  // anything, which is the point of the line. Each payload carries its count,
  // and a payload that lost it still deserves a sentence.
  "task.due_soon": (line) => {
    const days = numberOf(line.data["daysLeft"]);
    if (days === null) return `${taskOf(line)} está perto do prazo`;
    if (days <= 0) return `${taskOf(line)} vence hoje`;
    if (days === 1) return `${taskOf(line)} vence amanhã`;
    return `${taskOf(line)} vence em ${dayCount(days)}`;
  },
  "task.overdue": (line) => {
    const days = numberOf(line.data["daysLate"]);
    return days === null || days <= 0
      ? `${taskOf(line)} passou do prazo`
      : `${taskOf(line)} passou do prazo há ${dayCount(days)}`;
  },
  "task.stalled": (line) => {
    const phase = phaseOf(line.data["phase"]);
    const days = numberOf(line.data["days"]);
    const where = phase ? ` em ${phase}` : "";
    const since = days === null || days <= 0 ? "" : ` há ${dayCount(days)}`;
    return `${taskOf(line)} parou${where}${since}`;
  },
};

/**
 * The same map, read by a verb that may not be in the catalogue at all:
 * `activity_logs` is history, and a row written before a verb was renamed
 * keeps the old word forever. Showing it as what it is beats showing nothing.
 */
const SENTENCE_BY_VERB: Partial<Record<string, Sentence>> = SENTENCE_OF;

export function describeActivity(line: ActivityLine): string {
  const sentence = SENTENCE_BY_VERB[line.verb];
  return sentence ? sentence(line) : `${actorOf(line)} · ${line.verb}`;
}

/** "há 5 min", "há 3 h", "há 2 dias" — the feed's timestamps, in pt-BR. */
export function timeAgo(when: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - when.getTime()) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${dayCount(days)}`;
}

function actorOf(line: ActivityLine): string {
  // A rule's action is signed by the product, never by a person (§4.6).
  if (line.actorKind !== "user") return "Planora";
  return line.actorName ?? "Alguém";
}

function taskOf(line: ActivityLine): string {
  return line.taskNumber === null ? "uma tarefa" : `TSK-${line.taskNumber}`;
}

function projectOf(line: ActivityLine): string {
  return line.projectName ?? "um projeto";
}

function titleOf(line: ActivityLine): string {
  const title = line.taskTitle ?? stringOf(line.data["title"]);
  return title ? ` · ${title}` : "";
}

function phaseOf(value: unknown): string | null {
  return typeof value === "string" ? phaseLabel(value) : null;
}

function verdictOf(value: unknown): string {
  return typeof value === "string" && value in VERDICT_LABELS
    ? VERDICT_LABELS[value as Verdict]
    : "outro estado";
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
