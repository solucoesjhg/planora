"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <section>
      <h1 className="text-xl font-semibold">Entrar</h1>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
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
            autoComplete="current-password"
            className="rounded border px-3 py-2"
          />
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
          {busy ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="mt-4 text-sm">
        Não tem conta?{" "}
        <Link href="/register" className="underline">
          Criar conta
        </Link>
      </p>
    </section>
  );
}
