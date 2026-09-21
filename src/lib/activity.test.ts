import { describe, expect, it } from "vitest";
import { describeActivity, timeAgo, type ActivityLine } from "./activity";
import { EVENT_TYPES } from "./events";

const base: ActivityLine = {
  verb: "task.moved",
  actorKind: "user",
  actorName: "Henrique",
  taskNumber: 7,
  taskTitle: "Pintura da parede norte",
  projectName: "Reforma da sala",
  columnName: "Execução",
  data: {},
};

/** A row the joins could not enrich: no names, no numbers, no payload. */
const bare: ActivityLine = {
  verb: "task.moved",
  actorKind: "automation",
  actorName: null,
  taskNumber: null,
  taskTitle: null,
  projectName: null,
  columnName: null,
  data: {},
};

describe("the activity feed speaks the interface's language", () => {
  it("names who, what and where", () => {
    expect(describeActivity(base)).toBe("Henrique moveu TSK-7 para Execução");
    expect(describeActivity({ ...base, verb: "task.created" })).toBe(
      "Henrique criou TSK-7 · Pintura da parede norte",
    );
    expect(describeActivity({ ...base, verb: "comment.added" })).toBe(
      "Henrique comentou em TSK-7",
    );
    expect(describeActivity({ ...base, verb: "project.completed" })).toBe(
      "Henrique concluiu o projeto Reforma da sala",
    );
  });

  it("falls back to the phase when the column is gone, and to nothing when both are", () => {
    expect(
      describeActivity({ ...base, columnName: null, data: { toPhase: "review" } }),
    ).toBe("Henrique moveu TSK-7 para Revisão");
    expect(describeActivity({ ...base, columnName: null })).toBe("Henrique moveu TSK-7");
  });

  it("signs a rule's action as the product, never as a person", () => {
    expect(
      describeActivity({
        ...base,
        verb: "project.health_changed",
        actorKind: "automation",
        actorName: null,
        data: { from: "healthy", to: "at_risk" },
      }),
    ).toBe("Reforma da sala passou de Saudável para Em risco");
    expect(describeActivity({ ...base, actorKind: "automation", actorName: "Henrique" })).toBe(
      "Planora moveu TSK-7 para Execução",
    );
  });

  it("names who a task was given to, and when it was taken from everyone", () => {
    expect(
      describeActivity({ ...base, verb: "task.assigned", data: { names: ["Ana", "Bruno"] } }),
    ).toBe("Henrique atribuiu TSK-7 a Ana, Bruno");
    expect(describeActivity({ ...base, verb: "task.assigned", data: { names: [] } })).toBe(
      "Henrique tirou os responsáveis de TSK-7",
    );
  });

  it("shows an unknown verb as what it is rather than inventing a sentence", () => {
    expect(describeActivity({ ...base, verb: "task.exploded" })).toBe(
      "Henrique · task.exploded",
    );
  });

  it("keeps the timestamp short", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(timeAgo(ago(20), now)).toBe("agora");
    expect(timeAgo(ago(5 * 60), now)).toBe("há 5 min");
    expect(timeAgo(ago(3 * 3600), now)).toBe("há 3 h");
    expect(timeAgo(ago(26 * 3600), now)).toBe("há 1 dia");
    expect(timeAgo(ago(4 * 86_400), now)).toBe("há 4 dias");
  });
});

/**
 * The coverage that cannot rot (§7 Phase 10). The dispatcher writes a row for
 * every catalogued event; this is the other half — every row becomes prose.
 * A table over the union rather than one case per verb, so a seventeenth
 * event type fails here the day it is added and not the day somebody scrolls
 * the dashboard.
 */
describe("every catalogued event type reaches the feed as a sentence", () => {
  it.each([...EVENT_TYPES])("says something a person can read about %s", (verb) => {
    for (const line of [{ ...base, verb }, { ...bare, verb }]) {
      const sentence = describeActivity(line);
      expect(sentence.trim().length).toBeGreaterThan(0);
      // The fallthrough prints the verb itself; a real sentence never does.
      expect(sentence).not.toContain(verb);
      expect(sentence).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });

  it("gives the clock's events the words the interface uses", () => {
    const due = (daysLeft: number) =>
      describeActivity({ ...base, verb: "task.due_soon", data: { daysLeft } });
    expect(due(0)).toBe("TSK-7 vence hoje");
    expect(due(1)).toBe("TSK-7 vence amanhã");
    expect(due(2)).toBe("TSK-7 vence em 2 dias");

    expect(
      describeActivity({ ...base, verb: "task.overdue", data: { daysLate: 1 } }),
    ).toBe("TSK-7 passou do prazo há 1 dia");
    expect(
      describeActivity({ ...base, verb: "task.overdue", data: { daysLate: 3 } }),
    ).toBe("TSK-7 passou do prazo há 3 dias");

    expect(
      describeActivity({ ...base, verb: "task.stalled", data: { days: 9, phase: "review" } }),
    ).toBe("TSK-7 parou em Revisão há 9 dias");
  });

  it("still says something when the payload lost its numbers", () => {
    expect(describeActivity({ ...base, verb: "task.due_soon" })).toBe(
      "TSK-7 está perto do prazo",
    );
    expect(describeActivity({ ...base, verb: "task.overdue" })).toBe(
      "TSK-7 passou do prazo",
    );
    expect(describeActivity({ ...base, verb: "task.stalled" })).toBe("TSK-7 parou");
    expect(describeActivity({ ...base, verb: "task.stalled", data: { phase: "review" } })).toBe(
      "TSK-7 parou em Revisão",
    );
  });
});
