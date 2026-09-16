import { describe, expect, it } from "vitest";
import { isActive } from "./nav";

const HREFS = [
  "/dashboard",
  "/projects",
  "/board",
  "/files",
  "/users",
  "/assistant",
  "/settings",
];

function lit(pathname: string): string[] {
  return HREFS.filter((href) => isActive(pathname, href));
}

describe("the rail's active entry", () => {
  it("lights Projetos on the list alone", () => {
    expect(lit("/projects")).toEqual(["/projects"]);
  });

  it("lights Quadro on a board, not Projetos", () => {
    expect(lit("/projects/01a0aa5b-acd3-7d3f-b2e5-04bf716e0d7c")).toEqual([
      "/board",
    ]);
  });

  it("lights Quadro on a task open over the board", () => {
    expect(lit("/projects/01a0aa5b/tasks/01a0aa5c")).toEqual(["/board"]);
  });

  it("lights Quadro on /board itself, while it redirects", () => {
    expect(lit("/board")).toEqual(["/board"]);
  });

  it("keeps the prefix rule for everything else", () => {
    expect(lit("/dashboard")).toEqual(["/dashboard"]);
    expect(lit("/settings/workspace")).toEqual(["/settings"]);
    expect(lit("/settingsx")).toEqual([]);
  });

  it("never lights two entries for one path", () => {
    for (const pathname of [
      "/",
      "/dashboard",
      "/projects",
      "/projects/abc",
      "/projects/abc/tasks/def",
      "/board",
      "/files",
      "/settings/x",
    ]) {
      expect(lit(pathname).length, pathname).toBeLessThanOrEqual(1);
    }
  });
});
