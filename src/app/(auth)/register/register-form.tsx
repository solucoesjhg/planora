"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordField, usePasswordCheck } from "@/features/auth/password-field";
import { authClient, signUp } from "@/lib/auth-client";
import { RATE_LIMITED, SIGN_UP_RATE_LIMITED } from "@/lib/strings";

/**
 * `next` is where the verification link should land — the invitation somebody
 * was following, most often. Without it a person who registered to accept an
 * invitation ends up on their own empty dashboard with the token left behind
 * in the email.
 */
export function RegisterForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");
  // The name and address as typed: the password may not contain them, and the
  // field says so before the server has to (ADR 0008).
  const [identity, setIdentity] = useState({ name: "", email: "" });
  const password = usePasswordCheck(identity);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    // A password the field already knows is refused is not sent: the field
    // says why, and the person keeps their attempts.
    if (password.settle()) {
      (form.elements.namedItem("password") as HTMLInputElement | null)?.focus();
      return;
    }

    setBusy(true);
    const data = new FormData(form);
    const address = String(data.get("email") ?? "");
    const result = await signUp.email({
      name: String(data.get("name") ?? ""),
      email: address,
      password: password.password,
      // Travels into the verification link, so the link lands here.
      callbackURL: next,
    });

    setBusy(false);
    if (result.error) {
      // A refused password arrives with its own message; a rate limit arrives
      // with none, and "não foi possível" would leave the person clicking again
      // into the same wall.
      setError(
        result.error.status === 429
          ? SIGN_UP_RATE_LIMITED
          : (result.error.message ?? "Não foi possível criar a conta."),
      );
      return;
    }
    setEmail(address);
    setSent(true);
  }

  /**
   * Sign-up hands the message to the sender in the background and reports
   * success whatever happened to it — on the first production deploy the screen
   * promised an email that Resend had refused. This endpoint waits for the
   * send and answers with the failure, so the second try is the one that
   * tells the truth.
   */
  async function resendEmail() {
    setResend("sending");
    setError(null);

    const result = await authClient.sendVerificationEmail({ email, callbackURL: next });

    if (result.error) {
      setResend("idle");
      setError(
        result.error.status === 429
          ? RATE_LIMITED
          : "O e-mail não pôde ser enviado. O log do servidor diz o motivo.",
      );
      return;
    }
    setResend("sent");
  }

  if (sent) {
    return (
      <section className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="rounded-full border border-line bg-surface p-3 text-sage">
          <MailCheck size={18} aria-hidden />
        </span>
        <h1 className="pln-display text-2xl text-primary">Confirme seu e-mail</h1>
        <p className="text-[13px] text-secondary">
          Enviamos um link de confirmação para{" "}
          <strong className="font-medium text-primary">{email}</strong>. Abra-o e
          entre com a senha que você escolheu. Ele vale por 15 minutos.
        </p>
        <p className="text-xs text-subtle">Não chegou? Confira o spam, ou peça outro.</p>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={resend !== "idle"}
          onClick={() => void resendEmail()}
        >
          {resend === "sending"
            ? "Enviando…"
            : resend === "sent"
              ? "Enviado de novo"
              : "Reenviar e-mail"}
        </Button>
      </section>
    );
  }

  const loginHref =
    next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`;

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
          {(id) => (
            <Input
              id={id}
              name="name"
              required
              autoComplete="name"
              value={identity.name}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, name: event.target.value }))
              }
            />
          )}
        </Field>

        <Field label="E-mail">
          {(id) => (
            <Input
              id={id}
              name="email"
              type="email"
              required
              autoComplete="email"
              value={identity.email}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, email: event.target.value }))
              }
            />
          )}
        </Field>

        <PasswordField label="Senha" check={password} autoComplete="new-password" />

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
        <Link href={loginHref} className="text-sienna underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </section>
  );
}
