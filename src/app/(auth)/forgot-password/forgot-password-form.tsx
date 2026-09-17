"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

/** Where the link in the message lands; the page reads `?token=` from it. */
const RESET_PAGE = "/reset-password";

/**
 * Asks for the address and reports the same thing whether or not an account
 * exists behind it — the endpoint answers 200 either way so that this screen
 * cannot be used to find out which addresses are registered.
 */
export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const address = String(new FormData(event.currentTarget).get("email") ?? "");
    const result = await authClient.requestPasswordReset({
      email: address,
      redirectTo: RESET_PAGE,
    });

    setBusy(false);
    if (result.error) {
      setError(
        result.error.status === 429
          ? "Muitas tentativas seguidas. Espere um minuto e tente de novo."
          : "Não foi possível enviar o e-mail. Tente de novo em instantes.",
      );
      return;
    }
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <section className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="rounded-full border border-line bg-surface p-3 text-sage">
          <MailCheck size={18} aria-hidden />
        </span>
        <h1 className="pln-display text-2xl text-primary">Veja seu e-mail</h1>
        <p className="text-[13px] text-secondary">
          Se existe uma conta para{" "}
          <strong className="font-medium text-primary">{sentTo}</strong>, enviamos um
          link para redefinir a senha. Ele vale por uma hora.
        </p>
        <p className="text-xs text-subtle">Não chegou? Confira o spam.</p>
        <Link
          href="/login"
          className="text-[13px] text-sienna underline-offset-4 hover:underline"
        >
          Voltar para entrar
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="pln-display text-2xl text-primary">Recuperar senha</h1>
        <p className="text-[13px] text-secondary">
          Diga qual é o e-mail da conta e enviamos um link para escolher outra senha.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="E-mail">
          {(id) => (
            <Input id={id} name="email" type="email" required autoComplete="email" autoFocus />
          )}
        </Field>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Enviando..." : "Enviar link"}
        </Button>
      </form>

      <p className="text-[13px] text-secondary">
        Lembrou a senha?{" "}
        <Link href="/login" className="text-sienna underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </section>
  );
}
