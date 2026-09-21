import { notFound } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { TaskModal } from "@/features/tasks/task-modal";
import { requireWorkspace } from "@/server/auth/dal";
import { withTenant } from "@/server/db/client";
import { loadTaskView } from "@/server/modules/tasks/view";

/** The same task, intercepted over the board it was opened from. */
export default async function InterceptedTaskPage({
  params,
}: PageProps<"/projects/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await params;
  const workspace = await requireWorkspace();

  const task = await withTenant(workspace, (tx) => loadTaskView(tx, workspace, taskId));
  if (!task || task.project.id !== projectId) notFound();

  return (
    <ToastProvider>
      <TaskModal task={task} />
    </ToastProvider>
  );
}
