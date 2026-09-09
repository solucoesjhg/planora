"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { Field, Input } from "@/components/ui/field";
import { signUp } from "@/lib/auth-client";

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await signUp.email({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Não foi possível criar a conta.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <section className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="rounded-full border border-line bg-surface p-3 text-sage">
          <MailCheck size={18} aria-hidden />
        </span>
        <h1 className="pln-display text-2xl text-primary">Confirme seu e-mail</h1>
        <p className="text-[13px] text-secondary">
          Enviamos um link de confirmação. Ele vale por 15 minutos.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="pln-display text-2xl text-primary">Criar conta</h1>
        <p className="text-[13px] text-secondary">
          Seu espaço de trabalho nasce junto com ela.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Nome">
          {(id) => <Input id={id} name="name" required autoComplete="name" />}
        </Field>

        <Field label="E-mail">
          {(id) => (
            <Input id={id} name="email" type="email" required autoComplete="email" />
          )}
        </Field>

        <Field label="Senha" hint="Ao menos 10 caracteres.">
          {(id) => (
            <Input
              id={id}
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          )}
        </Field>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Criando..." : "Criar conta"}
        </Button>
      </form>

      <p className="text-[13px] text-secondary">
        Já tem conta?{" "}
        <Link href="/login" className="text-sienna underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </section>
  );
}
