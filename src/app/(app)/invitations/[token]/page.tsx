import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/strings";
import { hashToken } from "@/lib/token";
import { currentSession } from "@/server/auth/dal";
import { withInvitation } from "@/server/db/client";
import { acceptInvitationAction } from "@/server/modules/workspaces/actions";
import { previewInvitation } from "@/server/modules/workspaces/service";

const MESSAGES: Record<string, string> = {
  invalid: "Este convite não existe.",
  "invalid-token": "Este convite não existe.",
  used: "Este convite já foi usado.",
  expired: "Este convite expirou. Peça um novo a quem convidou você.",
  "already-member": "Você já faz parte deste espaço de trabalho.",
};

/**
 * An invitation, shown before it is accepted. Opening the link joins nobody to
 * anything — a mail client that prefetches links would otherwise accept on the
 * person's behalf — and the click that accepts also makes the workspace the
 * one this browser looks at.
 */
export default async function InvitationPage({
  params,
  searchParams,
}: PageProps<"/invitations/[token]">) {
  const { token } = await params;
  const { refused } = await searchParams;
  const session = await currentSession();

  // Signing in first is the point: an invitation binds a workspace to a person,
  // and there is no person here yet. Somebody without an account registers,
  // and the verification link brings them back here.
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/invitations/${token}`)}`);
  }

  // The token is the only thing this page has, so it is also what opens the
  // scope: the policy compares the same SHA-256 the row was stored under, and
  // the lane sees that one invitation and nothing else (ADR 0002).
  const preview = await withInvitation(await hashToken(token), session.userId, (tx) =>
    previewInvitation(tx, token),
  );
  const problem =
    typeof refused === "string"
      ? (MESSAGES[refused] ?? "Convite inválido.")
      : preview.status !== "open"
        ? MESSAGES[preview.status]
        : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-6 py-16">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">Convite</p>
        <h1 className="pln-display text-2xl text-primary">
          {preview.status === "open" ? preview.workspaceName : "Convite"}
        </h1>
      </header>

      {problem ? (
        <>
          <p className="text-[13px] text-secondary">{problem}</p>
          <Link
            href="/dashboard"
            className="w-fit text-[13px] text-sienna underline-offset-4 hover:underline"
          >
            Ir para o painel
          </Link>
        </>
      ) : preview.status === "open" ? (
        <>
          <p className="text-[13px] text-secondary">
            {preview.invitedByName} convidou você como{" "}
            <strong className="text-primary">
              {(ROLE_LABELS[preview.role] ?? preview.role).toLowerCase()}
            </strong>
            . Ao entrar, este espaço passa a ser o que você vê ao abrir o Planora.
          </p>

          <form action={acceptInvitationAction.bind(null, token)}>
            <Button type="submit" variant="primary">
              Entrar no espaço
            </Button>
          </form>
        </>
      ) : null}
    </main>
  );
}
