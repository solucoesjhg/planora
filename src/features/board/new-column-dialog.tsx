"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { createColumnAction } from "@/server/modules/board/actions";

/**
 * A column declares its phase, because the progress engine reads the phase and
 * not the name. Planning and Done are not offered: there is exactly one of each,
 * at the ends of the board.
 */
export function NewColumnDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"execution" | "review">("execution");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setError(null);

    startTransition(async () => {
      const result = await createColumnAction({ projectId, name, phase });

      if (!result.ok) {
        setError(
          result.reason === "forbidden"
            ? "Seu papel neste espaço não permite alterar o quadro."
            : "Não foi possível criar a coluna.",
        );
        return;
      }

      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="primary" size="sm" aria-label="Nova coluna">
            <Plus size={14} aria-hidden />
            <span className="hidden md:inline">Nova coluna</span>
          </Button>
        }
      />

      <DialogContent
        title="Nova coluna"
        description="A fase decide quanto uma tarefa nesta coluna vale de progresso."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Nome">
            {(id) => (
              <Input id={id} name="name" required maxLength={60} placeholder="Testes" autoFocus />
            )}
          </Field>

          <Field
            label="Fase"
            hint="Execução vale de 30% a 69%; revisão, de 70% a 99%."
          >
            {(id) => (
              <Select
                id={id}
                value={phase}
                onValueChange={(value) =>
                  setPhase(value === "review" ? "review" : "execution")
                }
                items={[
                  { value: "execution", label: "Execução" },
                  { value: "review", label: "Revisão" },
                ]}
              />
            )}
          </Field>

          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Criando..." : "Criar coluna"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
