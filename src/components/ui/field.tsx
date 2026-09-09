import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-control border border-line bg-input px-3 text-sm text-primary",
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

export type FieldProps = {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly className?: string;
  readonly children: (id: string) => ReactNode;
};

/**
 * Label, control, and the two lines that explain it. The control is a render
 * prop so the label's `for` and the field's `id` cannot drift apart.
 */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-secondary">
        {label}
      </label>

      {children(id)}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
