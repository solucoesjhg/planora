"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { TaskDocument } from "./task-document";
import type { TaskView } from "@/server/modules/tasks/view";

/**
 * The intercepted view: the same document, over the board it was opened from,
 * with the same URL as the page. Closing it goes back to the board rather than
 * navigating anywhere new — the board underneath never re-rendered.
 */
export function TaskModal({ task }: { task: TaskView }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function close(next: boolean): void {
    setOpen(next);
    if (!next) router.back();
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={close}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]",
            "transition-opacity duration-200",
            "data-starting-style:opacity-0 data-ending-style:opacity-0",
          )}
        />

        <BaseDialog.Popup
          data-testid="task-modal"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-3rem)] w-[min(56rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line",
            "bg-panel text-primary shadow-popup",
            "transition-[opacity,scale] duration-200 ease-out",
            "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
          )}
        >
          <BaseDialog.Title className="sr-only">
            TSK-{task.number} {task.title}
          </BaseDialog.Title>

          <header className="flex items-center justify-end gap-1 border-b border-hairline px-3 py-2">
            <Link
              href={`/projects/${task.project.id}/tasks/${task.id}`}
              aria-label="Abrir em página inteira"
              className="rounded-control p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-primary"
            >
              <ExternalLink size={15} aria-hidden />
            </Link>

            <BaseDialog.Close
              aria-label="Fechar"
              className="rounded-control p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-primary"
            >
              <X size={15} aria-hidden />
            </BaseDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <TaskDocument task={task} />
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
