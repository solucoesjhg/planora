import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
};

/**
 * An empty screen should say what is missing and offer the way out of it —
 * never just sit there. The v1 shipped bare empty lists; this replaces them.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-panel border border-dashed border-line",
        "px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="rounded-full border border-line bg-surface p-3 text-muted">
          <Icon size={18} aria-hidden />
        </span>
      ) : null}

      <div className="flex flex-col gap-1">
        <p className="pln-display text-lg text-primary">{title}</p>
        {description ? (
          <p className="max-w-sm text-[13px] text-secondary">{description}</p>
        ) : null}
      </div>

      {action}
    </div>
  );
}
