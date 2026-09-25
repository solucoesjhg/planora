"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signIn } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { CONFIRMATION_HEADER } from "@/lib/confirmation-link";
import { RATE_LIMITED, SIGN_IN_REFUSED } from "@/lib/strings";

/** What the confirmation link left behind for this form to say. */
export type LoginNotice = {
  readonly tone: "done" | "problem";
  readonly message: string;
};

/** A confirmation link that is still good, and the address it was sent to. */
export type PendingConfirmation = {
  readonly token: string;
  readonly email: string;
};

export function LoginForm({
  next,
  notice = null,
  confirmation = null,
}: {
  readonly next: string;
  /**
   * The confirmation link lands here, and the form owes the person a reason
   * for being shown.
   */
  readonly notice?: LoginNotice | null;
  /**
   * Sent along with the password: signing in with both is what confirms the
   * address (ADR 0007).
   */
  readonly confirmation?: PendingConfirmation | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await signIn.email(
      {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
      confirmation ? { headers: { [CONFIRMATION_HEADER]: confirmation.token } } : undefined,
    );

    setBusy(false);
    if (result.error) {
      setError(refusal(result.error, confirmation !== null));
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

      {notice ? (
        <p
          role="status"
          className={cn(
            "rounded-control border border-hairline bg-panel px-3 py-2 text-[13px]",
            notice.tone === "problem" ? "text-danger" : "text-secondary",
          )}
        >
          {notice.message}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="E-mail">
          {(id) => (
            <Input
              id={id}
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={confirmation?.email}
            />
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
        <Link href="/forgot-password" className="text-sienna underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
      </p>

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

/**
 * What a refused sign-in says. With a confirmation link, a wrong password
 * may be the right one for the person and the wrong one for this account —
 * one somebody else created with their address — and the way out is the same
 * either way: a new password, set from the mailbox.
 */
function refusal(
  error: { status: number; code?: string | undefined },
  confirming: boolean,
): string {
  if (error.status === 429) return RATE_LIMITED;
  if (error.code === "EMAIL_NOT_VERIFIED") return SIGN_IN_REFUSED.EMAIL_NOT_VERIFIED;
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") {
    return confirming
      ? SIGN_IN_REFUSED.CONFIRMATION_PASSWORD_MISMATCH
      : SIGN_IN_REFUSED.INVALID_EMAIL_OR_PASSWORD;
  }
  return SIGN_IN_REFUSED.FALLBACK;
}
