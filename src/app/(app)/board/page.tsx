import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { listProjects } from "@/server/modules/projects/repository";
import { AccountMenu } from "@/app/(app)/dashboard/account-menu";

/**
 * The rail's "Quadro" entry. A board belongs to a project, so this opens the
 * first active one rather than inventing a board with nothing on it.
 */
export default async function BoardIndexPage() {
  const session = await requireSession();
  const workspace = await requireWorkspace();
  const projects = await listProjects(getDatabase(), workspace);

  const active = projects.find((project) => project.status === "active");
  if (active) redirect(`/projects/${active.id}`);

  return (
    <AppShell
      title="Quadro"
      account={<AccountMenu name={session.name} email={session.email} />}
    >
      <EmptyState
        icon={FolderKanban}
        title="Nenhum projeto em andamento"
        description="O quadro pertence a um projeto. Crie um e ele abre aqui."
        action={
          <Link href="/projects">
            <Button variant="primary">Ir para projetos</Button>
          </Link>
        }
      />
    </AppShell>
  );
}
