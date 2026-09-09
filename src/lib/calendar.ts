/**
 * Month grid arithmetic, kept apart from the component that draws it so the
 * awkward cases — leap years, months that start on a Sunday, the six-week
 * February — are testable without a browser.
 */

export type CalendarDay = {
  readonly date: Date;
  readonly inMonth: boolean;
};

/** Sunday first, the way a Brazilian wall calendar reads. */
export const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"] as const;

export const MONTH_LABELS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/**
 * Always six rows of seven days, so the grid does not change height as the
 * user pages through months — the layout shift is what makes a date picker
 * feel cheap.
 */
export function monthGrid(month: Date): CalendarDay[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { date, inMonth: date.getMonth() === month.getMonth() };
  });
}

export function addMonths(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function monthLabel(month: Date): string {
  return `${MONTH_LABELS[month.getMonth()]} de ${month.getFullYear()}`;
}

/** `2026-09-08`, the form the database and the URL both use. */
export function toISODate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
