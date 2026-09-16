"use client";

import { Plus } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { createTaskAction } from "@/server/modules/tasks/actions";

/**
 * A card is written where it will live: in its column, from a line at the
 * head of it that stays open for the next one. The card itself lands at the
 * foot, in board order; the control stays put so it never drifts as the
 * column grows. The document behind the card is filled in later, by opening
 * it.
 */
export function NewTask({
  projectId,
  columnId,
}: {
  projectId: string;
  columnId: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const next = title.trim();
    if (next.length === 0) return;

    setTitle("");
    field.current?.focus();

    startTransition(async () => {
      const result = await createTaskAction({ projectId, columnId, title: next });
      if (!result.ok) {
        toast.add({
          title:
            result.reason === "forbidden"
              ? "Seu papel neste espaço permite ler, não criar tarefas."
              : "Não deu para criar a tarefa.",
        });
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          // The field mounts on the next paint.
          setTimeout(() => field.current?.focus(), 0);
        }}
        className={cn(
          "flex min-h-11 items-center gap-1.5 rounded-card px-2 py-1.5 text-[12px] text-subtle md:min-h-0",
          "transition-colors hover:bg-card-hover hover:text-secondary",
        )}
      >
        <Plus size={13} aria-hidden />
        Nova tarefa
      </button>
    );
  }

  return (
    <form onSubmit={submit}>
      <input
        ref={field}
        value={title}
        aria-label="Título da nova tarefa"
        placeholder="O que precisa ser feito?"
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (title.trim().length === 0) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className={cn(
          "min-h-[3rem] w-full rounded-card border border-line bg-card px-3 py-2",
          "text-[13px] text-primary placeholder:text-subtle",
          "focus-visible:border-line-strong focus-visible:outline-none",
        )}
      />
    </form>
  );
}
