import { describe, expect, it } from "vitest";
import {
  addMonths,
  isSameDay,
  monthGrid,
  monthLabel,
  toISODate,
} from "./calendar";

describe("monthGrid", () => {
  it("always returns six weeks, so the grid never changes height", () => {
    for (let month = 0; month < 12; month += 1) {
      expect(monthGrid(new Date(2026, month, 1))).toHaveLength(42);
    }
  });

  it("starts on the Sunday on or before the first of the month", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on 30 August.
    const grid = monthGrid(new Date(2026, 8, 1));

    expect(grid[0]?.date.getDay()).toBe(0);
    expect(toISODate(grid[0]!.date)).toBe("2026-08-30");
    expect(grid[0]?.inMonth).toBe(false);
  });

  it("opens on the first when the month starts on a Sunday", () => {
    // 1 February 2026 is a Sunday.
    const grid = monthGrid(new Date(2026, 1, 1));

    expect(toISODate(grid[0]!.date)).toBe("2026-02-01");
    expect(grid[0]?.inMonth).toBe(true);
  });

  it("counts the extra day of a leap February", () => {
    const inMonth = monthGrid(new Date(2028, 1, 1)).filter((day) => day.inMonth);

    expect(inMonth).toHaveLength(29);
    expect(toISODate(inMonth.at(-1)!.date)).toBe("2028-02-29");
  });

  it("marks the days that belong to the neighbouring months", () => {
    const grid = monthGrid(new Date(2026, 8, 1));

    expect(grid.filter((day) => day.inMonth)).toHaveLength(30);
    expect(grid.every((day) => day.date instanceof Date)).toBe(true);
  });
});

describe("month helpers", () => {
  it("crosses the year boundary in both directions", () => {
    expect(toISODate(addMonths(new Date(2026, 11, 1), 1))).toBe("2027-01-01");
    expect(toISODate(addMonths(new Date(2026, 0, 1), -1))).toBe("2025-12-01");
  });

  it("compares by calendar day, not by instant", () => {
    expect(
      isSameDay(new Date(2026, 8, 8, 23, 59), new Date(2026, 8, 8, 0, 1)),
    ).toBe(true);
    expect(isSameDay(new Date(2026, 8, 8), new Date(2026, 8, 9))).toBe(false);
    expect(isSameDay(null, new Date(2026, 8, 8))).toBe(false);
  });

  it("names the month in pt-BR", () => {
    expect(monthLabel(new Date(2026, 2, 1))).toBe("março de 2026");
  });
});
