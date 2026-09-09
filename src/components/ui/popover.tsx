"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;

export type PopoverContentProps = ComponentProps<typeof BasePopover.Popup> & {
  readonly align?: "start" | "center" | "end";
  readonly sideOffset?: number;
};

export function PopoverContent({
  align = "start",
  sideOffset = 8,
  className,
  ...props
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <BasePopover.Popup
          className={cn(
            "min-w-56 rounded-panel border border-line bg-panel-elevated p-2 text-primary shadow-popup",
            "origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-out",
            "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
            className,
          )}
          {...props}
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
