"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  PasswordField,
  passwordRefusalOf,
  usePasswordCheck,
} from "@/features/auth/password-field";
import { authClient } from "@/lib/auth-client";
import { RESET_RATE_LIMITED } from "@/lib/strings";

/**
 * The second half of recovery: a new password against the token from the
 * message. The token is single-use and an hour old at most; when it is gone
 * the only honest answer is another link, so the expired state leads there.
 */
export function ResetPasswordForm({
  token,
  expired,
}: {
  token: string | null;
  expired: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(expired);
  // No name or address here — the form only holds the token. The server still
  // refuses the person's own name at submit (ADR 0008).
  const password = usePasswordCheck({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);

    const passwordInput = event.currentTarget.elements.namedItem(
      "password",
    ) as HTMLInputElement | null;
    // What the input holds now, not what the page has heard: text typed before
    // it hydrated is only in the input.
    const typed = passwordInput?.value ?? "";
    if (password.settle(typed)) {
      passwordInput?.focus();
      return;
    }

    setBusy(true);
    const result = await authClient.resetPassword({ newPassword: typed, token });

    setBusy(false);
    if (result.error) {
      if (result.error.code === "INVALID_TOKEN") {
        // Used, expired, or never real: the form cannot help any more.
        setStale(true);
        return;
      }
      // The server refused the password — most often the person's own name,
      // which only the server knows here. The field says so, and will not
      // send it again.
      const refusal = passwordRefusalOf(result.error);
      if (refusal) {
        password.refuse(typed, refusal);
        passwordInput?.focus();
        return;
      }
      setError(
        result.error.status === 429
          ? RESET_RATE_LIMITED
          : (result.error.message ?? "Não foi possível redefinir a senha."),
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <section className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="rounded-full border border-line bg-surface p-3 text-sage">
          <KeyRound size={18} aria-hidden />
        </span>
        <h1 className="pln-display text-2xl text-primary">Senha redefinida</h1>
        <p className="text-[13px] text-secondary">
          Entre com a nova senha. Quem estava conectado com a antiga foi desconectado.
        </p>
        <Link href="/login" className={buttonClassName({ variant: "primary" }, "mt-1")}>
          Entrar
        </Link>
      </section>
    );
  }

  if (stale) {
    return (
      <section className="flex flex-col gap-3 py-2">
        <h1 className="pln-display text-2xl text-primary">Este link não vale mais</h1>
        <p className="text-[13px] text-secondary">
          Links de redefinição valem por uma hora e só uma vez. Peça outro e use o mais
          recente.
        </p>
        <Link
          href="/forgot-password"
          className={buttonClassName({ variant: "primary" }, "mt-1 self-start")}
        >
          Pedir outro link
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="pln-display text-2xl text-primary">Nova senha</h1>
        <p className="text-[13px] text-secondary">
          Escolha a senha que vai usar daqui em diante.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <PasswordField
          label="Nova senha"
          check={password}
          autoComplete="new-password"
          autoFocus
        />

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </form>

      <p className="text-[13px] text-secondary">
        <Link href="/login" className="text-sienna underline-offset-4 hover:underline">
          Voltar para entrar
        </Link>
      </p>
    </section>
  );
}
