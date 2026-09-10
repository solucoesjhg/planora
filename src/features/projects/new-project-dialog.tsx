"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { createProjectAction } from "@/server/modules/projects/actions";

export function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await createProjectAction({
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        clientName: String(form.get("clientName") ?? ""),
        startDate: String(form.get("startDate") ?? ""),
        dueDate: String(form.get("dueDate") ?? ""),
      });

      if (!result.ok) {
        setError(
          result.reason === "forbidden"
            ? "Seu papel neste espaço não permite criar projetos."
            : "Não foi possível criar o projeto.",
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
          <Button variant="primary">
            <Plus size={15} aria-hidden />
            Novo projeto
          </Button>
        }
      />

      <DialogContent
        title="Novo projeto"
        description="O quadro nasce com as quatro fases: planejamento, execução, revisão e concluído."
      >
        <form id="new-project" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Nome">
            {(id) => (
              <Input
                id={id}
                name="name"
                required
                maxLength={120}
                placeholder="Reforma da sala"
                autoFocus
              />
            )}
          </Field>

          <Field label="Cliente" hint="Opcional. Um cliente novo é criado se não existir.">
            {(id) => <Input id={id} name="clientName" maxLength={120} />}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Início">
              {(id) => <Input id={id} name="startDate" type="date" />}
            </Field>
            <Field label="Prazo">
              {(id) => <Input id={id} name="dueDate" type="date" />}
            </Field>
          </div>

          <Field label="Descrição" hint="Opcional.">
            {(id) => <Textarea id={id} name="description" maxLength={500} />}
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
              {pending ? "Criando..." : "Criar projeto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
