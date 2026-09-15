/**
 * What a notification says (DEVELOPMENT_PLAN.md §7 Phase 9), in the
 * interface's words. Pure: the sentences are tested without a database, and
 * the same text goes to the inbox, the email and the digest.
 */

import type { Verdict } from "@/domain/health";
import { VERDICT_LABELS, phaseLabel } from "./strings";

/** The event types that reach a person, and the defaults for each channel. */
export const NOTIFIABLE_TYPES = [
  "task.assigned",
  "comment.added",
  "task.completed",
  "task.blocked",
  "dependency.resolved",
  "task.due_soon",
  "task.overdue",
  "task.stalled",
  "project.health_changed",
  "automation.notify",
] as const;
export type NotifiableType = (typeof NOTIFIABLE_TYPES)[number];

export type Channels = { readonly inApp: boolean; readonly email: boolean };

/** Everything reaches the inbox; email only for what cannot wait for a visit. */
export const DEFAULT_CHANNELS: Record<NotifiableType, Channels> = {
  "task.assigned": { inApp: true, email: true },
  "comment.added": { inApp: true, email: false },
  "task.completed": { inApp: true, email: false },
  "task.blocked": { inApp: true, email: false },
  "dependency.resolved": { inApp: true, email: false },
  "task.due_soon": { inApp: true, email: false },
  "task.overdue": { inApp: true, email: true },
  "task.stalled": { inApp: true, email: false },
  "project.health_changed": { inApp: true, email: true },
  "automation.notify": { inApp: true, email: true },
};

export const NOTIFICATION_TYPE_LABELS: Record<NotifiableType, string> = {
  "task.assigned": "Tarefa atribuída a você",
  "comment.added": "Comentário em tarefa sua",
  "task.completed": "Tarefa sua concluída",
  "task.blocked": "Tarefa sua travada",
  "dependency.resolved": "Tarefa sua ficou livre",
  "task.due_soon": "Prazo se aproximando",
  "task.overdue": "Prazo passou",
  "task.stalled": "Tarefa estagnada",
  "project.health_changed": "Saúde do projeto mudou",
  "automation.notify": "Aviso de automação",
};

export function isNotifiable(type: string): type is NotifiableType {
  return (NOTIFIABLE_TYPES as readonly string[]).includes(type);
}

/** The channels a person gets for a type: their choice, or the default. */
export function channelsFor(
  type: NotifiableType,
  chosen: Partial<Record<string, Partial<Channels>>> | null | undefined,
): Channels {
  const base = DEFAULT_CHANNELS[type];
  const own = chosen?.[type];
  return { inApp: own?.inApp ?? base.inApp, email: own?.email ?? base.email };
}

export type NotificationSubject = {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly actorName: string | null;
  readonly actorKind: string;
  readonly taskId: string | null;
  readonly taskNumber: number | null;
  readonly taskTitle: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
};

export type NotificationText = {
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
};

export function notificationText(subject: NotificationSubject): NotificationText {
  const who = subject.actorKind === "user" ? (subject.actorName ?? "Alguém") : "Planora";
  const task = subject.taskNumber === null ? "Uma tarefa" : `TSK-${subject.taskNumber}`;
  const title = subject.taskTitle ? ` · ${subject.taskTitle}` : "";
  const project = subject.projectName ?? "um projeto";
  const href =
    subject.taskId && subject.projectId
      ? `/projects/${subject.projectId}/tasks/${subject.taskId}`
      : subject.projectId
        ? `/projects/${subject.projectId}`
        : null;

  switch (subject.type) {
    case "task.assigned":
      return { title: `${task} é sua agora`, body: `${who} atribuiu ${task}${title} a você.`, href };
    case "comment.added":
      return { title: `Comentário em ${task}`, body: `${who} comentou em ${task}${title}.`, href };
    case "task.completed":
      return { title: `${task} concluída`, body: `${who} concluiu ${task}${title}.`, href };
    case "task.blocked": {
      const reason = stringOf(subject.data["reason"]);
      return {
        title: `${task} travada`,
        body: `${who} travou ${task}${title}${reason ? `: ${reason}` : "."}`,
        href,
      };
    }
    case "dependency.resolved":
      return {
        title: `${task} ficou livre`,
        body: `O que ${task}${title} esperava foi concluído.`,
        href,
      };
    case "task.due_soon": {
      const days = numberOf(subject.data["daysLeft"]);
      const when = days === 0 ? "vence hoje" : days === 1 ? "vence amanhã" : `vence em ${days} dias`;
      return { title: `${task} ${when}`, body: `${task}${title}, em ${project}.`, href };
    }
    case "task.overdue": {
      const days = numberOf(subject.data["daysLate"]);
      return {
        title: `${task} está atrasada`,
        body: `${days} ${days === 1 ? "dia" : "dias"} de atraso: ${task}${title}, em ${project}.`,
        href,
      };
    }
    case "task.stalled": {
      const days = numberOf(subject.data["days"]);
      const phase = stringOf(subject.data["phase"]);
      return {
        title: `${task} parou`,
        body: `${days} dias em ${phase ? phaseLabel(phase) : "uma coluna"}: ${task}${title}, em ${project}.`,
        href,
      };
    }
    case "project.health_changed": {
      const to = verdictOf(subject.data["to"]);
      const from = verdictOf(subject.data["from"]);
      return { title: `${project}: ${to}`, body: `A saúde passou de ${from} para ${to}.`, href };
    }
    case "automation.notify":
      return {
        title: stringOf(subject.data["title"]) ?? "Aviso de automação",
        body: stringOf(subject.data["message"]) ?? "",
        href,
      };
    default:
      return { title: subject.type, body: `${who} · ${subject.type}`, href };
  }
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function verdictOf(value: unknown): string {
  return typeof value === "string" && value in VERDICT_LABELS
    ? VERDICT_LABELS[value as Verdict]
    : "outro estado";
}
