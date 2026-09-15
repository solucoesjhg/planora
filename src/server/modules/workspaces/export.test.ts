import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, csvCell, toCsv, toJson, type WorkspaceExport } from "./export";

const sample: WorkspaceExport = {
  workspace: { id: "ws", name: "Planora" },
  exportedAt: "2026-09-15T12:00:00.000Z",
  projects: [
    {
      id: "p1",
      name: "Reforma, fase 1",
      description: "",
      status: "active",
      client: null,
      startDate: null,
      dueDate: "2026-10-01",
      columns: [{ name: "Execução", phase: "execution" }],
      tasks: [
        {
          id: "t1",
          number: 3,
          title: 'Pintar a parede "norte"',
          body: "<p>x</p>",
          internalNotes: "",
          column: "Execução",
          phase: "execution",
          priority: "high",
          blocked: true,
          blockReason: "Aguardando a tinta\nchegar",
          startDate: null,
          dueDate: "2026-09-20",
          assignees: ["Ana", "Bruno"],
          dependsOn: [1],
          checklist: [
            { title: "a", done: true },
            { title: "b", done: false },
          ],
          comments: [{ author: "Ana", body: "ok", at: "2026-09-10T00:00:00.000Z" }],
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("the workspace export", () => {
  it("writes one CSV row per task, with the header the spreadsheet expects", () => {
    const csv = toCsv(sample);
    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '"Reforma, fase 1",TSK-3,"Pintar a parede ""norte""",execution,Execução,high,sim,' +
        '"Aguardando a tinta\nchegar",,2026-09-20,Ana; Bruno,TSK-1,1,2,1,2026-09-01T00:00:00.000Z',
    );
  });

  it("quotes only what needs quoting", () => {
    expect(csvCell("simples")).toBe("simples");
    expect(csvCell("com, vírgula")).toBe('"com, vírgula"');
    expect(csvCell('com "aspas"')).toBe('"com ""aspas"""');
    expect(csvCell("")).toBe("");
  });

  it("opens in Excel with its accents intact", () => {
    expect(toCsv(sample).startsWith("﻿")).toBe(true);
  });

  it("keeps everything in the JSON, including what the CSV flattens", () => {
    const parsed = JSON.parse(toJson(sample)) as WorkspaceExport;
    expect(parsed.projects[0]?.tasks[0]?.comments[0]?.author).toBe("Ana");
    expect(parsed.projects[0]?.tasks[0]?.checklist).toHaveLength(2);
    expect(parsed.exportedAt).toBe(sample.exportedAt);
  });
});
