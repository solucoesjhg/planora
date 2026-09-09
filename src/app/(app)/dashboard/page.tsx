import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { SignOutButton } from "./sign-out-button";

// A placeholder until Phase 8 builds the real panel. What it proves today is
// that the DAL resolves a session into a tenant context, and that a workspace
// exists the moment an account does.
export default async function DashboardPage() {
  const session = await requireSession();
  const workspace = await requireWorkspace();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">Painel</h1>
        <SignOutButton />
      </header>

      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="opacity-70">Conta</dt>
          <dd>
            {session.name} · {session.email}
          </dd>
        </div>
        <div>
          <dt className="opacity-70">Espaço de trabalho</dt>
          <dd className="font-mono">{workspace.workspaceId}</dd>
        </div>
        <div>
          <dt className="opacity-70">Papel</dt>
          <dd>{workspace.role}</dd>
        </div>
      </dl>

      <p className="text-sm opacity-70">
        Projetos, quadro e saúde chegam nas fases 5 a 8.
      </p>
    </main>
  );
}
