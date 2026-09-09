import Link from "next/link";
import { redirect } from "next/navigation";
import { isRefused } from "@/lib/result";
import { currentSession } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { acceptInvitation } from "@/server/modules/workspaces/service";

const MESSAGES: Record<string, string> = {
  "invalid-token": "Este convite não existe ou já foi usado.",
  expired: "Este convite expirou. Peça um novo a quem convidou você.",
  "already-member": "Você já faz parte deste espaço de trabalho.",
};

export default async function InvitationPage({
  params,
}: PageProps<"/invitations/[token]">) {
  const { token } = await params;
  const session = await currentSession();

  // Signing in first is the point: an invitation binds a workspace to a person,
  // and there is no person here yet.
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/invitations/${token}`)}`);
  }

  const result = await acceptInvitation(getDatabase(), {
    token,
    userId: session.userId,
  });

  if (!isRefused(result)) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold">Convite</h1>
      <p className="text-sm">{MESSAGES[result.reason] ?? "Convite inválido."}</p>
      <Link href="/dashboard" className="text-sm underline">
        Ir para o painel
      </Link>
    </main>
  );
}
