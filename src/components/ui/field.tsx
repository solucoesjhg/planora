import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-control border border-line bg-input px-3 text-sm text-primary",
        "placeholder:text-subtle",
        "transition-colors duration-150 hover:border-line-strong",
        "focus-visible:border-sienna focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:text-disabled",
        "aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-control border border-line bg-input px-3 py-2 text-sm text-primary",
        "placeholder:text-subtle transition-colors duration-150 hover:border-line-strong",
        "focus-visible:border-sienna focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/** A line under the control that changes as the person types. */
export type FieldStatus = {
  readonly tone: "neutral" | "success" | "danger";
  readonly text: string;
};

export type FieldProps = {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  /**
   * A line in place of the hint that changes as the person types — the
   * password field's verdict, for one. It describes the control, so focusing
   * the control reads it; it is not a live region, because a line that
   * changes on every keystroke would be read on every keystroke. What to
   * announce, and when, is the caller's.
   */
  readonly status?: FieldStatus;
  readonly className?: string;
  /** `describedBy` names the line under the control, when there is one. */
  readonly children: (id: string, describedBy?: string) => ReactNode;
};

const STATUS_TONE: Record<FieldStatus["tone"], string> = {
  neutral: "text-subtle",
  success: "text-sage",
  danger: "text-danger",
};

/**
 * Label, control, and the two lines that explain it. The control is a render
 * prop so the label's `for` and the field's `id` cannot drift apart.
 */
export function Field({ label, hint, error, status, className, children }: FieldProps) {
  const id = useId();
  const describedBy = status ? `${id}-status` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-secondary">
        {label}
      </label>

      {children(id, describedBy)}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : status ? (
        <p id={describedBy} className={cn("text-xs", STATUS_TONE[status.tone])}>
          {status.text}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
