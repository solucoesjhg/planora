import { describe, expect, it } from "vitest";
import { isActive, safeDestination } from "./nav";

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

describe("safeDestination", () => {
  it("keeps a path on this site, with its query and hash", () => {
    expect(safeDestination("/projects/1")).toBe("/projects/1");
    expect(safeDestination("/board?filter=meus#topo")).toBe("/board?filter=meus#topo");
  });

  it("falls back when there is nothing to go on", () => {
    expect(safeDestination(undefined)).toBe("/dashboard");
    expect(safeDestination(["/a", "/b"])).toBe("/dashboard");
    expect(safeDestination("")).toBe("/dashboard");
    expect(safeDestination("dashboard")).toBe("/dashboard");
  });

  it("refuses an absolute URL", () => {
    expect(safeDestination("https://evil.example/x")).toBe("/dashboard");
    expect(safeDestination("javascript:alert(1)")).toBe("/dashboard");
  });

  /**
   * The two that a leading-slash check lets through, and a browser reads as
   * another host. This is the open redirect the check used to leave open.
   */
  it("refuses the forms that start with a slash and still leave the site", () => {
    expect(safeDestination("//evil.example")).toBe("/dashboard");
    expect(safeDestination("//evil.example/path")).toBe("/dashboard");
    // A single backslash after the slash: browsers normalise it to "//".
    expect(safeDestination("/\\evil.example")).toBe("/dashboard");
    expect(safeDestination("/\\\\evil.example")).toBe("/dashboard");
    // And one that only looks like it: an encoded slash stays a path segment.
    expect(safeDestination("/%2f%2fevil.example")).toBe("/%2f%2fevil.example");
  });

  it("takes a fallback of its own", () => {
    expect(safeDestination("//evil.example", "/login")).toBe("/login");
  });
});

/**
 * The bypass that the origin check alone does not catch: the `..` is consumed
 * while resolving, so the parsed URL is internal, and the string it serialises
 * to is protocol-relative. Whoever receives that string resolves it again, off
 * this site, immediately after a successful sign-in.
 */
describe("safeDestination against dot segments", () => {
  it("refuses a path that climbs out into another host", () => {
    expect(safeDestination("/..//evil.example")).toBe("/dashboard");
    expect(safeDestination("/.//evil.example")).toBe("/dashboard");
    expect(safeDestination("/a/b/../../..//evil.example")).toBe("/dashboard");
    expect(safeDestination("/%2e%2e//evil.example")).toBe("/dashboard");
    expect(safeDestination("/..//evil.example/harvest?x=1")).toBe("/dashboard");
  });

  it("still keeps a path whose dot segments stay inside", () => {
    expect(safeDestination("/projects/../board")).toBe("/board");
  });
});
