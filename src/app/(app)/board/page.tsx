import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { listProjects } from "@/server/modules/projects/repository";
import { AccountBar } from "@/features/workspace/account-bar";
import { LAST_BOARD_COOKIE } from "@/lib/last-board";

/**
 * The rail's "Quadro" entry. A board belongs to a project, so this opens one
 * rather than inventing a board with nothing on it: the board this browser
 * opened last if it is still an active project here, else the first active
 * one. The cookie is only ever a hint — an id from another workspace, or a
 * project since completed, falls through to the default.
 */
export default async function BoardIndexPage() {
  const workspace = await requireWorkspace();
  const projects = await listProjects(getDatabase(), workspace);

  const active = projects.filter((project) => project.status === "active");
  const remembered = (await cookies()).get(LAST_BOARD_COOKIE)?.value;
  const chosen = active.find((project) => project.id === remembered) ?? active[0];
  if (chosen) redirect(`/projects/${chosen.id}`);

  return (
    <AppShell
      title="Quadro"
      account={<AccountBar />}
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
