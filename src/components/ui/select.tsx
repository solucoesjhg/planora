"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type SelectProps = {
  readonly items: readonly SelectOption[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly id?: string;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  /** An accessible name when no `<Field>` labels the trigger. */
  readonly "aria-label"?: string;
};

export function Select({
  items,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Selecionar",
  id,
  name,
  disabled,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  return (
    <BaseSelect.Root
      items={items as SelectOption[]}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onValueChange
        ? {
            // Base UI reports null when the selection is cleared; the caller
            // asked for a value, so an empty selection reads as "".
            onValueChange: (next: string | null) => onValueChange(next ?? ""),
          }
        : {})}
      {...(name ? { name } : {})}
      {...(disabled ? { disabled } : {})}
    >
      <BaseSelect.Trigger
        id={id}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-control border border-line",
          "bg-input px-3 text-sm text-primary transition-colors duration-150",
          "hover:border-line-strong focus-visible:border-sienna focus-visible:outline-none",
          "data-disabled:cursor-not-allowed data-disabled:text-disabled",
          className,
        )}
      >
        <BaseSelect.Value className="data-placeholder:text-subtle" placeholder={placeholder} />
        <BaseSelect.Icon className="text-muted">
          <ChevronsUpDown size={14} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} className="z-50 outline-none">
          <BaseSelect.Popup
            className={cn(
              "min-w-[var(--anchor-width)] rounded-panel border border-line bg-panel-elevated p-1",
              "text-primary shadow-popup outline-none",
              "origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-out",
              "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
              "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
            )}
          >
            <BaseSelect.List className="max-h-[var(--available-height)] overflow-y-auto">
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  className={cn(
                    "flex cursor-default items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5",
                    "text-sm text-secondary outline-none",
                    "data-highlighted:bg-card-hover data-highlighted:text-primary",
                    "data-selected:text-primary",
                  )}
                >
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-sienna">
                    <Check size={14} aria-hidden />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
