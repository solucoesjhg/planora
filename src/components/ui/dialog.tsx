"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export type DialogContentProps = ComponentProps<typeof BaseDialog.Popup> & {
  readonly title: string;
  readonly description?: string;
  readonly footer?: ReactNode;
};

export function DialogContent({
  title,
  description,
  footer,
  children,
  className,
  ...props
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]",
          "transition-opacity duration-200",
          "data-starting-style:opacity-0 data-ending-style:opacity-0",
        )}
      />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
          "flex-col gap-4 rounded-panel border border-line bg-panel p-5 text-primary shadow-popup",
          "transition-[opacity,scale] duration-200 ease-out",
          "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
          "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <BaseDialog.Title className="pln-display text-xl text-primary">
              {title}
            </BaseDialog.Title>
            {description ? (
              <BaseDialog.Description className="text-[13px] text-secondary">
                {description}
              </BaseDialog.Description>
            ) : null}
          </div>

          <BaseDialog.Close
            aria-label="Fechar"
            className="rounded-control p-1 text-muted transition-colors hover:bg-card-hover hover:text-primary"
          >
            <X size={16} aria-hidden />
          </BaseDialog.Close>
        </header>

        {children ? <div className="text-sm text-secondary">{children}</div> : null}

        {footer ? (
          <footer className="flex justify-end gap-2 pt-1">{footer}</footer>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
