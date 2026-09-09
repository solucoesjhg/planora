import { describe, expect, it } from "vitest";
import { SEED_EPOCH } from "@/fixtures/board";
import { archiveNotes, archivedPhaseCount } from "./phase-history";

describe("archiveNotes", () => {
  it("moves the phase's notes into the body and clears the field", () => {
    const result = archiveNotes({
      body: "<p>Especificação inicial.</p>",
      notes: "<p>Cliente pediu revisão do escopo.</p>",
      label: "Execução",
      at: SEED_EPOCH,
    });

    expect(result.notes).toBe("");
    expect(result.body).toContain("<p>Especificação inicial.</p>");
    expect(result.body).toContain('<section data-phase-note="2026-09-01">');
    expect(result.body).toContain("<h3>Execução — 2026-09-01</h3>");
    expect(result.body).toContain("<p>Cliente pediu revisão do escopo.</p>");
  });

  it("leaves the body untouched when there is nothing to archive", () => {
    const body = "<p>Nada mudou.</p>";

    expect(archiveNotes({ body, notes: "   ", label: "Revisão", at: SEED_EPOCH })).toStrictEqual({
      body,
      notes: "",
    });
  });

  it("accumulates one section per phase left behind", () => {
    const first = archiveNotes({
      body: "",
      notes: "<p>Planejamento.</p>",
      label: "Planejamento",
      at: SEED_EPOCH,
    });
    const second = archiveNotes({
      body: first.body,
      notes: "<p>Execução.</p>",
      label: "Execução",
      at: SEED_EPOCH,
    });

    expect(archivedPhaseCount(second.body)).toBe(2);
  });

  it("is deterministic for the same inputs", () => {
    const input = {
      body: "<p>a</p>",
      notes: "<p>b</p>",
      label: "Revisão",
      at: SEED_EPOCH,
    };

    expect(archiveNotes(input)).toStrictEqual(archiveNotes(input));
  });

  it("escapes a label rather than trusting it as markup", () => {
    const result = archiveNotes({
      body: "",
      notes: "<p>x</p>",
      label: '<img src=x onerror="alert(1)">',
      at: SEED_EPOCH,
    });

    expect(result.body).not.toContain("<img");
    expect(result.body).toContain("&lt;img");
  });
});
