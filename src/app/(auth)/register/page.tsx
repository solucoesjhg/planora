"use client";

import Link from "next/link";
import { useState } from "react";
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
      <section>
        <h1 className="text-xl font-semibold">Confirme seu e-mail</h1>
        <p className="mt-3 text-sm">
          Enviamos um link de confirmação. Abra-o para ativar sua conta.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-xl font-semibold">Criar conta</h1>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Nome
          <input name="name" required autoComplete="name" className="rounded border px-3 py-2" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          E-mail
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Senha
          <input
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="rounded border px-3 py-2"
          />
          <span className="text-xs opacity-70">Ao menos 10 caracteres.</span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded bg-black px-3 py-2 text-white disabled:opacity-60"
        >
          {busy ? "Criando..." : "Criar conta"}
        </button>
      </form>

      <p className="mt-4 text-sm">
        Já tem conta? <Link href="/login" className="underline">Entrar</Link>
      </p>
    </section>
  );
}
