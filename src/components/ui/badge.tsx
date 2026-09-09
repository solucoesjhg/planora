import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "planning"
  | "execution"
  | "review"
  | "done"
  | "high"
  | "medium"
  | "low"
  | "blocked";

/**
 * A badge is a hairline and a word. Colour arrives as a thin border and a tint,
 * never as a filled block — a card whose background is a status colour is what
 * the v1 guidelines forbid outright.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "border-line text-secondary",
  planning: "border-phase-planning/40 text-phase-planning bg-phase-planning/8",
  execution: "border-phase-execution/40 text-phase-execution bg-phase-execution/8",
  review: "border-phase-review/40 text-phase-review bg-phase-review/8",
  done: "border-phase-done/40 text-phase-done bg-phase-done/8",
  high: "border-priority-high/40 text-priority-high bg-priority-high/8",
  medium: "border-priority-medium/40 text-priority-medium bg-priority-medium/8",
  low: "border-priority-low/40 text-priority-low bg-priority-low/8",
  blocked: "border-danger/50 text-danger bg-danger/10",
};

export type BadgeProps = ComponentProps<"span"> & {
  readonly tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-[11px] font-medium tracking-[0.02em] whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
