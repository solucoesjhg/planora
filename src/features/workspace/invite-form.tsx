"use client";

import { Send } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { Role } from "@/server/auth/tenant";
import { inviteMemberAction } from "@/server/modules/workspaces/actions";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "member", label: "Membro — cria e move tarefas" },
  { value: "manager", label: "Gerente — também administra projetos e colunas" },
  { value: "admin", label: "Admin — também convida gente" },
  { value: "viewer", label: "Visitante — só lê" },
];

const REFUSALS: Record<string, string> = {
  forbidden: "Seu papel neste espaço não permite convidar.",
  "already-member": "Essa pessoa já está no espaço de trabalho.",
  "already-invited": "Já existe um convite em aberto para esse e-mail.",
  undeliverable:
    "O provedor de e-mail recusou a entrega. Com o remetente de teste do Resend só dá para escrever para o seu próprio endereço — verifique um domínio para convidar outras pessoas.",
};

/**
 * The screen the invitation flow never had. `inviteMember` and its tests have
 * existed since Phase 3; without this, nothing could call them.
 */
export function InviteForm() {
  const toast = useToast();
  const [role, setRole] = useState<Role>("member");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) return;

    startTransition(async () => {
      const result = await inviteMemberAction({ email, role });

      if (!result.ok) {
        toast.add({ title: REFUSALS[result.reason] ?? "Não deu para convidar." });
        return;
      }

      form.reset();
      toast.add({
        title: "Convite enviado",
        description: `${email} recebeu um link válido por sete dias.`,
      });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-4 sm:flex-row sm:items-end"
    >
      <Field label="E-mail" className="flex-1">
        {(id) => (
          <Input
            id={id}
            name="email"
            type="email"
            required
            placeholder="pessoa@empresa.com"
          />
        )}
      </Field>

      <Field label="Papel" className="sm:w-64">
        {(id) => (
          <Select
            id={id}
            items={ROLE_OPTIONS}
            value={role}
            onValueChange={(value) => setRole(value as Role)}
          />
        )}
      </Field>

      <Button type="submit" variant="primary" disabled={pending}>
        <Send size={14} aria-hidden />
        {pending ? "Enviando…" : "Convidar"}
      </Button>
    </form>
  );
}
