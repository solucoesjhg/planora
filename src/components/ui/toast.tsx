"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A refusal is not an error dialog (§3.6): the card bounces back and a toast
 * names the reason. This is that toast.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

export const useToast = BaseToast.useToastManager;

function ToastList() {
  const { toasts } = BaseToast.useToastManager();

  return toasts.map((toast) => (
    <BaseToast.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "flex items-start gap-3 rounded-panel border border-line bg-panel-elevated p-3",
        "text-primary shadow-popup",
        "transition-[opacity,transform] duration-200 ease-out",
        "data-starting-style:translate-x-2 data-starting-style:opacity-0",
        "data-ending-style:translate-x-2 data-ending-style:opacity-0",
      )}
    >
      <BaseToast.Content className="flex min-w-0 flex-1 flex-col gap-0.5">
        <BaseToast.Title className="text-[13px] font-medium" />
        <BaseToast.Description className="text-xs text-secondary" />
      </BaseToast.Content>

      <BaseToast.Close
        aria-label="Fechar aviso"
        className="rounded-control p-1 text-muted transition-colors hover:bg-card-hover hover:text-primary"
      >
        <X size={14} aria-hidden />
      </BaseToast.Close>
    </BaseToast.Root>
  ));
}
