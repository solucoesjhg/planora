"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

/**
 * The name the workspace sees. The address is Better Auth's to change, with a
 * verification of its own, and stays read-only here (§7 Phase 8).
 */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!next || next === name) return;

    setBusy(true);
    const result = await authClient.updateUser({ name: next });
    setBusy(false);

    if (result.error) {
      toast.add({ title: "Não deu para salvar o nome." });
      return;
    }
    toast.add({ title: "Nome atualizado" });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Nome" className="flex-1">
        {(id) => (
          <Input id={id} name="name" defaultValue={name} required maxLength={120} autoComplete="name" />
        )}
      </Field>
      <Field label="E-mail" className="flex-1" hint="Não muda por aqui.">
        {(id) => <Input id={id} value={email} readOnly disabled />}
      </Field>
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
