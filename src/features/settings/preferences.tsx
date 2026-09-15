"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { setHideCompletedAction } from "@/server/modules/workspaces/actions";

/** Whether finished projects stay on the grid. */
export function HideCompletedSwitch({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle(): void {
    const next = !hidden;
    setHidden(next);
    startTransition(async () => {
      await setHideCompletedAction(next);
      router.refresh();
    });
  }

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-[13px]">
      <span className="flex flex-col">
        <span className="text-primary">Ocultar projetos concluídos</span>
        <span className="text-xs text-subtle">
          Na lista de projetos, os concluídos somem em vez de ficarem apagados.
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        aria-label="Ocultar projetos concluídos"
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full border transition-colors",
          hidden ? "border-sienna bg-sienna" : "border-line bg-card-hover",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-on-accent transition-[left]",
            hidden ? "left-5" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}
