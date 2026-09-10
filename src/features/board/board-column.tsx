"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { forwardRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  deleteColumnAction,
  renameColumnAction,
} from "@/server/modules/board/actions";
import type { BoardColumnView } from "@/server/modules/board/view";

const PHASE_LABELS: Record<string, string> = {
  planning: "planejamento",
  execution: "execução",
  review: "revisão",
  done: "concluído",
};

export type BoardColumnProps = {
  readonly column: BoardColumnView;
  readonly projectId: string;
  readonly count: number;
  readonly isOver?: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
};

export const BoardColumn = forwardRef<HTMLElement, BoardColumnProps>(
  function BoardColumn({ column, projectId, count, isOver, children, footer }, ref) {
    const immutable = column.phase === "planning" || column.phase === "done";

    return (
      <section
        ref={ref}
        data-testid="board-column"
        data-column-phase={column.phase}
        data-column-name={column.name}
        className={cn(
          "flex w-[--pln-column-w] shrink-0 flex-col rounded-column border border-line",
          "bg-surface transition-colors duration-150",
          isOver && "border-sienna/50 bg-card-hover",
        )}
      >
        <header className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              column.phase === "planning" && "bg-phase-planning",
              column.phase === "execution" && "bg-phase-execution",
              column.phase === "review" && "bg-phase-review",
              column.phase === "done" && "bg-phase-done",
            )}
          />

          <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary">
            {column.name}
          </h3>

          <span className="font-mono text-[11px] text-subtle">{count}</span>

          <ColumnMenu
            column={column}
            projectId={projectId}
            immutable={immutable}
            empty={count === 0}
          />
        </header>

        <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {children}
          {footer}
        </div>
      </section>
    );
  },
);

function ColumnMenu({
  column,
  projectId,
  immutable,
  empty,
}: {
  column: BoardColumnView;
  projectId: string;
  immutable: boolean;
  empty: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");

    startTransition(async () => {
      const result = await renameColumnAction({
        projectId,
        columnId: column.id,
        name,
      });
      setOpen(false);

      if (!result.ok) {
        toast.add({ title: "Não foi possível renomear a coluna" });
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteColumnAction({ projectId, columnId: column.id });
      setOpen(false);

      if (!result.ok) {
        toast.add({
          title:
            result.reason === "not-empty"
              ? "A coluna ainda tem tarefas"
              : "Não foi possível apagar a coluna",
          description:
            result.reason === "not-empty"
              ? "Mova os cartões antes de apagar — nenhum some por engano."
              : "Planejamento e Concluído são fixos nas pontas do quadro.",
        });
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Opções da coluna ${column.name}`}
            className="rounded-control p-1 text-subtle transition-colors hover:bg-card-hover hover:text-primary"
          >
            <MoreHorizontal size={15} aria-hidden />
          </button>
        }
      />

      <PopoverContent align="end" className="w-64">
        <form onSubmit={rename} className="flex flex-col gap-3">
          <Field label="Nome da coluna" hint={`Fase: ${PHASE_LABELS[column.phase]}`}>
            {(id) => (
              <Input id={id} name="name" defaultValue={column.name} maxLength={60} />
            )}
          </Field>

          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={immutable || !empty}
              onClick={remove}
              title={
                immutable
                  ? "Planejamento e Concluído são fixos"
                  : empty
                    ? undefined
                    : "Mova os cartões antes"
              }
            >
              <Trash2 size={13} aria-hidden />
              Apagar
            </Button>

            <Button size="sm" variant="primary" type="submit">
              Salvar
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
