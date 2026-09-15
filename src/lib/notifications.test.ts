import { describe, expect, it } from "vitest";
import { channelsFor, notificationText, type NotificationSubject } from "./notifications";

const base: NotificationSubject = {
  type: "task.assigned",
  data: {},
  actorName: "Henrique",
  actorKind: "user",
  taskId: "t1",
  taskNumber: 7,
  taskTitle: "Pintura da parede norte",
  projectId: "p1",
  projectName: "Reforma da sala",
};

describe("a notification says what happened, to the person it happened to", () => {
  it("names the task and links to it", () => {
    expect(notificationText(base)).toEqual({
      title: "TSK-7 é sua agora",
      body: "Henrique atribuiu TSK-7 · Pintura da parede norte a você.",
      href: "/projects/p1/tasks/t1",
    });
  });

  it("reads the clock's events", () => {
    expect(notificationText({ ...base, type: "task.due_soon", data: { daysLeft: 1 } }).title).toBe(
      "TSK-7 vence amanhã",
    );
    expect(notificationText({ ...base, type: "task.due_soon", data: { daysLeft: 0 } }).title).toBe(
      "TSK-7 vence hoje",
    );
    expect(notificationText({ ...base, type: "task.overdue", data: { daysLate: 3 } }).body).toBe(
      "3 dias de atraso: TSK-7 · Pintura da parede norte, em Reforma da sala.",
    );
    expect(
      notificationText({ ...base, type: "task.stalled", data: { days: 9, phase: "review" } }).body,
    ).toBe("9 dias em Revisão: TSK-7 · Pintura da parede norte, em Reforma da sala.");
  });

  it("speaks of the project when the subject is the project", () => {
    expect(
      notificationText({
        ...base,
        type: "project.health_changed",
        actorKind: "automation",
        actorName: null,
        taskId: null,
        taskNumber: null,
        taskTitle: null,
        data: { from: "attention", to: "critical" },
      }),
    ).toEqual({
      title: "Reforma da sala: Crítico",
      body: "A saúde passou de Atenção para Crítico.",
      href: "/projects/p1",
    });
  });

  it("carries a rule's own words", () => {
    expect(
      notificationText({
        ...base,
        type: "automation.notify",
        actorKind: "automation",
        data: { title: "Regra: prazo", message: "Olhe esta tarefa hoje." },
      }),
    ).toMatchObject({ title: "Regra: prazo", body: "Olhe esta tarefa hoje." });
  });

  it("applies a person's choice over the default, channel by channel", () => {
    expect(channelsFor("comment.added", null)).toEqual({ inApp: true, email: false });
    expect(channelsFor("comment.added", { "comment.added": { email: true } })).toEqual({
      inApp: true,
      email: true,
    });
    expect(channelsFor("task.assigned", { "task.assigned": { inApp: false, email: false } })).toEqual({
      inApp: false,
      email: false,
    });
  });
});
