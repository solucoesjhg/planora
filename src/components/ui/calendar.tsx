"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  addMonths,
  isSameDay,
  monthGrid,
  monthLabel,
  toISODate,
  WEEKDAY_LABELS,
} from "@/lib/calendar";

export type CalendarProps = {
  readonly value?: Date | null;
  readonly onSelect?: (date: Date) => void;
  readonly today?: Date;
  readonly className?: string;
};

/**
 * Written rather than installed: a month grid is a hundred lines and one
 * dependency less. The arithmetic lives in `lib/calendar.ts`, with tests.
 */
export function Calendar({
  value = null,
  onSelect,
  today = new Date(),
  className,
}: CalendarProps) {
  const [month, setMonth] = useState(() => startOfMonth(value ?? today));
  const days = monthGrid(month);

  return (
    <div className={cn("w-[17.5rem] select-none", className)}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => setMonth(addMonths(month, -1))}
          className="rounded-control p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-primary"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>

        <span aria-live="polite" className="text-[13px] font-medium text-primary capitalize">
          {monthLabel(month)}
        </span>

        <button
          type="button"
          aria-label="Próximo mês"
          onClick={() => setMonth(addMonths(month, 1))}
          className="rounded-control p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-primary"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </header>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label, index) => (
          <span
            key={`${label}-${index}`}
            aria-hidden
            className="pb-1 text-center text-[11px] font-medium text-subtle"
          >
            {label}
          </span>
        ))}

        {days.map(({ date, inMonth }) => {
          const selected = isSameDay(date, value);
          const isToday = isSameDay(date, today);

          return (
            <button
              key={toISODate(date)}
              type="button"
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => onSelect?.(date)}
              className={cn(
                "h-8 rounded-[8px] text-[13px] transition-colors duration-150",
                inMonth ? "text-secondary" : "text-disabled",
                "hover:bg-card-hover hover:text-primary",
                isToday && !selected && "border border-line text-primary",
                selected &&
                  "border border-sienna/60 bg-sienna-soft font-medium text-sienna",
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
