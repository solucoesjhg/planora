import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { TaskDocument } from "@/features/tasks/task-document";
import { requireSession, requireWorkspace } from "@/server/auth/dal";
import { getDatabase } from "@/server/db/client";
import { loadTaskView } from "@/server/modules/tasks/view";
import { AccountMenu } from "@/app/(app)/dashboard/account-menu";

/**
 * The task's own page — the URL that can be shared, and what somebody who
 * follows that link lands on. The board opens the same view intercepted, over
 * the cards it came from.
 */
export default async function TaskPage({
  params,
}: PageProps<"/projects/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await params;
  const session = await requireSession();
  const workspace = await requireWorkspace();

  const task = await loadTaskView(getDatabase(), workspace, taskId);
  if (!task || task.project.id !== projectId) notFound();

  return (
    <ToastProvider>
      <AppShell
        title={`TSK-${task.number}`}
        account={<AccountMenu name={session.name} email={session.email} />}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-10">
          <Link
            href={`/projects/${projectId}`}
            className="flex w-fit items-center gap-1.5 text-[13px] text-secondary transition-colors hover:text-primary"
          >
            <ArrowLeft size={14} aria-hidden />
            {task.project.name}
          </Link>

          <TaskDocument task={task} />
        </div>
      </AppShell>
    </ToastProvider>
  );
}
