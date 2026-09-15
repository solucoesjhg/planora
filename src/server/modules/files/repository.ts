/**
 * The global files gallery (DEVELOPMENT_PLAN.md §7 Phase 8): every stored
 * attachment in the workspace, with the project and the task it belongs to
 * and who sent it. Only `stored` rows — a `pending` one is an upload the
 * store never confirmed, not a file anybody can open.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import type { TenantContext } from "@/server/auth/tenant";
import type { Executor } from "@/server/db/client";
import { attachments, projects, tasks, users } from "@/server/db/schema";
import { attachmentUrl } from "@/server/modules/tasks/attachments";

export type FileEntry = {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly url: string;
  readonly isImage: boolean;
  readonly createdAt: Date;
  readonly uploadedBy: string;
  readonly project: { readonly id: string; readonly name: string; readonly status: string };
  readonly task: { readonly id: string; readonly number: number; readonly title: string } | null;
};

export type ProjectFiles = {
  readonly project: FileEntry["project"];
  readonly files: readonly FileEntry[];
  readonly bytes: number;
};

export async function listFiles(executor: Executor, context: TenantContext): Promise<FileEntry[]> {
  const rows = await executor
    .select({
      id: attachments.id,
      name: attachments.name,
      mime: attachments.mime,
      size: attachments.size,
      createdAt: attachments.createdAt,
      uploadedBy: users.name,
      projectId: projects.id,
      projectName: projects.name,
      projectStatus: projects.status,
      projectPosition: projects.position,
      taskId: tasks.id,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
    })
    .from(attachments)
    .innerJoin(
      projects,
      and(eq(projects.workspaceId, context.workspaceId), eq(projects.id, attachments.projectId)),
    )
    .leftJoin(
      tasks,
      and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.id, attachments.taskId)),
    )
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    .where(
      and(eq(attachments.workspaceId, context.workspaceId), eq(attachments.status, "stored")),
    )
    .orderBy(asc(projects.position), asc(projects.id), desc(attachments.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: attachmentUrl(row.id),
    isImage: row.mime.startsWith("image/"),
    createdAt: row.createdAt,
    uploadedBy: row.uploadedBy,
    project: { id: row.projectId, name: row.projectName, status: row.projectStatus },
    task:
      row.taskId !== null && row.taskNumber !== null && row.taskTitle !== null
        ? { id: row.taskId, number: row.taskNumber, title: row.taskTitle }
        : null,
  }));
}

/** The gallery's shape: one group per project, in the grid's order. */
export function groupByProject(files: readonly FileEntry[]): ProjectFiles[] {
  const groups = new Map<string, { project: FileEntry["project"]; files: FileEntry[]; bytes: number }>();

  for (const file of files) {
    const group = groups.get(file.project.id) ?? { project: file.project, files: [], bytes: 0 };
    group.files.push(file);
    group.bytes += file.size;
    groups.set(file.project.id, group);
  }

  return [...groups.values()];
}
