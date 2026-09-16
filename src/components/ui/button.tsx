import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  // Burnt sienna carries the primary action, as a soft fill rather than a
  // saturated block: the v1 guidelines call the finish matte.
  primary:
    "border-sienna/50 bg-sienna-soft text-sienna hover:bg-sienna/20 hover:border-sienna/70 active:bg-sienna/25",
  secondary:
    "border-line bg-surface text-primary hover:bg-card-hover hover:border-line-strong",
  ghost:
    "border-transparent bg-transparent text-secondary hover:bg-surface hover:text-primary",
  danger:
    "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/60",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-11 gap-2 px-4 text-sm",
};

export type ButtonProps = ComponentProps<"button"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-control border font-medium",
        "transition-colors duration-150",
        "disabled:pointer-events-none disabled:border-line disabled:bg-transparent disabled:text-disabled",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
