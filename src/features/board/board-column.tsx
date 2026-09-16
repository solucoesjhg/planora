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
import { phaseLabel } from "@/lib/strings";

export type BoardColumnProps = {
  readonly column: BoardColumnView;
  readonly projectId: string;
  readonly count: number;
  readonly isOver?: boolean;
  readonly children: ReactNode;
  /** The column's own control — "Nova tarefa" — pinned above the cards. */
  readonly action?: ReactNode;
};

export const BoardColumn = forwardRef<HTMLElement, BoardColumnProps>(
  function BoardColumn({ column, projectId, count, isOver, children, action }, ref) {
    const immutable = column.phase === "planning" || column.phase === "done";

    return (
      <section
        ref={ref}
        data-testid="board-column"
        data-column-phase={column.phase}
        data-column-name={column.name}
        className={cn(
          "pln-tray flex w-full shrink-0 snap-center flex-col overflow-hidden",
          "md:w-auto md:min-w-column md:flex-1 md:shrink md:snap-align-none",
          "rounded-column border border-line bg-app-soft transition-colors duration-150",
          "max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none",
          isOver && "border-sienna/50",
        )}
      >
        <span aria-hidden className="pln-phase-veil hidden md:block" />

        <header className="hidden h-[var(--pln-column-header-h)] items-center gap-2.5 px-4 md:flex">
          <span aria-hidden className="pln-phase-dot shrink-0" />

          <h3 className="pln-display min-w-0 flex-1 truncate text-[19px] tracking-[-0.01em] text-primary">
            {column.name}
          </h3>

          <span className="pln-phase-count font-mono text-[12px] text-secondary">
            {count}
          </span>

          <ColumnMenu
            column={column}
            projectId={projectId}
            immutable={immutable}
            empty={count === 0}
          />
        </header>

        {/*
          Above the cards and outside the strip that scrolls, so it is in the
          same place on every column and stays there however many cards pile
          up below it — the foot of a long column is wherever you have
          scrolled to; the head is always the head.
        */}
        {action ? <div className="pt-1 md:px-3 md:pt-3">{action}</div> : null}

        <div className="pln-scrollbar flex min-h-24 flex-1 flex-col gap-3 pb-3 pt-3 md:overflow-y-auto md:px-3">
          {children}
        </div>
      </section>
    );
  },
);

export function ColumnMenu({
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
          <Field label="Nome da coluna" hint={`Fase: ${phaseLabel(column.phase).toLowerCase()}`}>
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
