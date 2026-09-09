"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SheetProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side: "left" | "right";
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * The drawer the rail and the side panel become on a narrow screen. Built on
 * the dialog primitive rather than on a div, so focus is trapped and Escape
 * closes it — a panel that slides in and strands the keyboard is worse than no
 * panel.
 */
export function Sheet({
  open,
  onOpenChange,
  side,
  title,
  children,
  className,
}: SheetProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-overlay",
            "transition-opacity duration-200",
            "data-starting-style:opacity-0 data-ending-style:opacity-0",
          )}
        />
        <BaseDialog.Popup
          className={cn(
            "fixed inset-y-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col",
            "border-line bg-panel shadow-popup",
            "transition-transform duration-200 ease-out",
            side === "left"
              ? "left-0 border-r data-starting-style:-translate-x-full data-ending-style:-translate-x-full"
              : "right-0 border-l data-starting-style:translate-x-full data-ending-style:translate-x-full",
            className,
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <BaseDialog.Title className="pln-display text-base text-primary">
              {title}
            </BaseDialog.Title>
            <BaseDialog.Close
              aria-label="Fechar"
              className="rounded-control p-1 text-muted transition-colors hover:bg-card-hover hover:text-primary"
            >
              <X size={16} aria-hidden />
            </BaseDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
