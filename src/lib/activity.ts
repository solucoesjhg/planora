/**
 * One line of the activity feed, in the interface's words.
 *
 * The event catalogue (§4.5) is English and so are its payloads; this is
 * where an entry becomes a sentence a person reads. Pure, so the sentences
 * can be tested without a database — and so the feed cannot invent a verb
 * the catalogue does not have: an unknown one is shown as what it is.
 */

import { VERDICT_LABELS, phaseLabel } from "./strings";
import type { Verdict } from "@/domain/health";

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

export function describeActivity(line: ActivityLine): string {
  const who = actorOf(line);
  const task = line.taskNumber === null ? "uma tarefa" : `TSK-${line.taskNumber}`;
  const project = line.projectName ?? "um projeto";

  switch (line.verb) {
    case "task.created":
      return `${who} criou ${task}${titleOf(line)}`;
    case "task.moved": {
      const to = line.columnName ?? phaseOf(line.data["toPhase"]);
      return to ? `${who} moveu ${task} para ${to}` : `${who} moveu ${task}`;
    }
    case "task.completed":
      return `${who} concluiu ${task}${titleOf(line)}`;
    case "task.assigned": {
      const names = namesOf(line.data["names"]);
      return names.length === 0
        ? `${who} tirou os responsáveis de ${task}`
        : `${who} atribuiu ${task} a ${names.join(", ")}`;
    }
    case "task.blocked":
      return `${who} travou ${task}`;
    case "task.unblocked":
      return `${who} destravou ${task}`;
    case "checklist.completed":
      return `${who} fechou o checklist de ${task}`;
    case "comment.added":
      return `${who} comentou em ${task}`;
    case "dependency.resolved":
      return `${task} ficou livre: o que ela esperava foi concluído`;
    case "project.created":
      return `${who} criou o projeto ${project}`;
    case "project.completed":
      return `${who} concluiu o projeto ${project}`;
    case "project.reopened":
      return `${who} reabriu o projeto ${project}`;
    case "project.health_changed":
      return `${project} passou de ${verdictOf(line.data["from"])} para ${verdictOf(line.data["to"])}`;
    case "member.invited":
      return `${who} convidou ${stringOf(line.data["email"]) ?? "alguém"}`;
    default:
      return `${who} · ${line.verb}`;
  }
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
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

function actorOf(line: ActivityLine): string {
  // A rule's action is signed by the product, never by a person (§4.6).
  if (line.actorKind !== "user") return "Planora";
  return line.actorName ?? "Alguém";
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
