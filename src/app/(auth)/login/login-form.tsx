"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signIn } from "@/lib/auth-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "E-mail ou senha incorretos.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="pln-display text-2xl text-primary">Entrar</h1>
        <p className="text-[13px] text-secondary">
          Retome de onde seus projetos pararam.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="E-mail">
          {(id) => (
            <Input id={id} name="email" type="email" required autoComplete="email" />
          )}
        </Field>

        <Field label="Senha">
          {(id) => (
            <Input
              id={id}
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          )}
        </Field>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Entrando..." : "Entrar"}
        </Button>
      </form>

      <p className="text-[13px] text-secondary">
        Não tem conta?{" "}
        <Link
          href={next === "/dashboard" ? "/register" : `/register?next=${encodeURIComponent(next)}`}
          className="text-sienna underline-offset-4 hover:underline"
        >
          Criar conta
        </Link>
      </p>
    </section>
  );
}
